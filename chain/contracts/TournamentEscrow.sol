// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TournamentEscrow
/// @notice Players stake INTEL on a match; the winner takes the pot.
///
/// This is where the commit-reveal guarantee earns its keep. Once real value
/// rides on the outcome, "trust the server" stops being acceptable — and the
/// refund path makes a dishonest or silent server actively expensive:
///
///   - The server settles before `settleDeadline` -> winner is paid.
///   - The server stays silent past it -> every player reclaims their own stake
///     and the server gains nothing. Refusing to reveal is no longer a free
///     way out of a match it was losing.
///
/// Same escrow shape as the TP's Escrow.sol (deposit, release, refund, roles),
/// but holding an ERC-20 instead of ETH and settling many players at once.
contract TournamentEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,     // never created
        Open,     // accepting stakes
        Locked,   // match in progress, no more joins
        Settled   // winner paid
    }

    struct Tournament {
        uint256 stake;          // per-player, in INTEL
        uint256 pot;            // total held
        uint8 maxPlayers;
        uint8 playerCount;
        uint64 joinDeadline;
        uint64 settleDeadline;
        address winner;
        State state;
    }

    IERC20 public immutable token;
    address public immutable gameServer;

    mapping(bytes32 => Tournament) private _tournaments;
    mapping(bytes32 => address[]) private _players;
    mapping(bytes32 => mapping(address => bool)) public hasJoined;
    mapping(bytes32 => mapping(address => bool)) public hasRefunded;

    event TournamentCreated(bytes32 indexed matchId, uint256 stake, uint8 maxPlayers, uint64 settleDeadline);
    event PlayerJoined(bytes32 indexed matchId, address indexed player, uint256 stake, uint256 pot);
    event TournamentLocked(bytes32 indexed matchId, uint8 playerCount, uint256 pot);
    event TournamentSettled(bytes32 indexed matchId, address indexed winner, uint256 payout);
    event StakeRefunded(bytes32 indexed matchId, address indexed player, uint256 amount);

    error NotGameServer();
    error WrongState();
    error AlreadyExists();
    error AlreadyJoined();
    error TournamentFull();
    error JoinClosed();
    error SettleWindowClosed();
    error SettleWindowOpen();
    error WinnerNotPlaying();
    error NotAPlayer();
    error AlreadyRefunded();
    error BadParameters();

    modifier onlyServer() {
        if (msg.sender != gameServer) revert NotGameServer();
        _;
    }

    constructor(IERC20 _token, address _gameServer) {
        require(address(_token) != address(0) && _gameServer != address(0), "invalid address");
        token = _token;
        gameServer = _gameServer;
    }

    // ───────────────────────────── Lifecycle ──────────────────────────────

    function createTournament(
        bytes32 matchId,
        uint256 stake,
        uint8 maxPlayers,
        uint64 joinWindowSeconds,
        uint64 settleWindowSeconds
    ) external onlyServer {
        if (_tournaments[matchId].state != State.None) revert AlreadyExists();
        if (stake == 0 || maxPlayers < 2 || maxPlayers > 4) revert BadParameters();
        if (joinWindowSeconds == 0 || settleWindowSeconds == 0) revert BadParameters();

        uint64 joinDeadline = uint64(block.timestamp) + joinWindowSeconds;
        uint64 settleDeadline = joinDeadline + settleWindowSeconds;

        _tournaments[matchId] = Tournament({
            stake: stake,
            pot: 0,
            maxPlayers: maxPlayers,
            playerCount: 0,
            joinDeadline: joinDeadline,
            settleDeadline: settleDeadline,
            winner: address(0),
            state: State.Open
        });

        emit TournamentCreated(matchId, stake, maxPlayers, settleDeadline);
    }

    /// @notice Stake and take a seat. The caller must `approve` this contract
    ///         for at least `stake` first — the standard two-step ERC-20 flow,
    ///         which is why MetaMask prompts twice.
    function join(bytes32 matchId) external nonReentrant {
        Tournament storage t = _tournaments[matchId];
        if (t.state != State.Open) revert WrongState();
        if (block.timestamp > t.joinDeadline) revert JoinClosed();
        if (hasJoined[matchId][msg.sender]) revert AlreadyJoined();
        if (t.playerCount >= t.maxPlayers) revert TournamentFull();

        hasJoined[matchId][msg.sender] = true;
        _players[matchId].push(msg.sender);
        t.playerCount += 1;
        t.pot += t.stake;

        token.safeTransferFrom(msg.sender, address(this), t.stake);
        emit PlayerJoined(matchId, msg.sender, t.stake, t.pot);

        // Full table closes itself, so the server need not send an extra tx.
        if (t.playerCount == t.maxPlayers) {
            t.state = State.Locked;
            emit TournamentLocked(matchId, t.playerCount, t.pot);
        }
    }

    /// @notice Close joins early (e.g. a 3-player match starting).
    function lock(bytes32 matchId) external onlyServer {
        Tournament storage t = _tournaments[matchId];
        if (t.state != State.Open) revert WrongState();
        if (t.playerCount < 2) revert BadParameters();
        t.state = State.Locked;
        emit TournamentLocked(matchId, t.playerCount, t.pot);
    }

    /// @notice Pay the pot to the winner. Only before the settle deadline —
    ///         after that the players' refund right takes precedence.
    function settle(bytes32 matchId, address winner) external onlyServer nonReentrant {
        Tournament storage t = _tournaments[matchId];
        if (t.state != State.Locked) revert WrongState();
        if (block.timestamp > t.settleDeadline) revert SettleWindowClosed();
        if (!hasJoined[matchId][winner]) revert WinnerNotPlaying();

        uint256 payout = t.pot;
        t.pot = 0;
        t.winner = winner;
        t.state = State.Settled;

        token.safeTransfer(winner, payout);
        emit TournamentSettled(matchId, winner, payout);
    }

    /// @notice If the server never settled, each player takes their stake back.
    ///         This is what makes staying silent costly rather than safe.
    function claimRefund(bytes32 matchId) external nonReentrant {
        Tournament storage t = _tournaments[matchId];
        if (t.state == State.Settled || t.state == State.None) revert WrongState();
        if (block.timestamp <= t.settleDeadline) revert SettleWindowOpen();
        if (!hasJoined[matchId][msg.sender]) revert NotAPlayer();
        if (hasRefunded[matchId][msg.sender]) revert AlreadyRefunded();

        hasRefunded[matchId][msg.sender] = true;
        uint256 amount = t.stake;
        t.pot -= amount;

        token.safeTransfer(msg.sender, amount);
        emit StakeRefunded(matchId, msg.sender, amount);
    }

    // ─────────────────────────────── Reads ────────────────────────────────

    function getTournament(bytes32 matchId) external view returns (Tournament memory) {
        return _tournaments[matchId];
    }

    function getPlayers(bytes32 matchId) external view returns (address[] memory) {
        return _players[matchId];
    }

    /// @notice True once players may reclaim their stakes.
    function refundAvailable(bytes32 matchId) external view returns (bool) {
        Tournament storage t = _tournaments[matchId];
        if (t.state == State.None || t.state == State.Settled) return false;
        return block.timestamp > t.settleDeadline;
    }
}
