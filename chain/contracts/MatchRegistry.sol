// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MatchRegistry
/// @notice Anchors finished matches so the leaderboard cannot be rewritten.
///
/// The live game runs off-chain — it ticks ten times a second, which no chain
/// could carry. Only the final, disputed-value facts are stored here: who won,
/// how, and each player's score line. One write per match, not per action.
contract MatchRegistry {
    struct PlayerResult {
        address player;
        uint8 slot;
        uint8 directivesConfirmed;
        uint8 cracksMade;
        uint32 finalIntel;
    }

    struct Match {
        bytes32 matchId;
        uint8 winnerSlot;
        uint8 winType; // 0 = OPERATION, 1 = BLACKOUT, 2 = TIMEOUT, 3 = FORFEIT
        uint64 finalizedAt;
        uint32 durationSeconds;
        bool exists;
    }

    address public immutable gameServer;

    mapping(bytes32 => Match) private _matches;
    mapping(bytes32 => PlayerResult[]) private _results;
    bytes32[] private _allMatches;

    /// Career totals, derived on write so reads stay cheap.
    mapping(address => uint32) public wins;
    mapping(address => uint32) public played;
    mapping(address => uint32) public totalCracks;

    event MatchFinalized(
        bytes32 indexed matchId,
        address indexed winner,
        uint8 winnerSlot,
        uint8 winType,
        uint32 durationSeconds
    );

    error NotGameServer();
    error AlreadyFinalized();
    error NoPlayers();
    error WinnerNotPlaying();

    modifier onlyServer() {
        if (msg.sender != gameServer) revert NotGameServer();
        _;
    }

    constructor(address _gameServer) {
        require(_gameServer != address(0), "invalid server");
        gameServer = _gameServer;
    }

    function finalizeMatch(
        bytes32 matchId,
        uint8 winnerSlot,
        uint8 winType,
        uint32 durationSeconds,
        PlayerResult[] calldata results
    ) external onlyServer {
        if (_matches[matchId].exists) revert AlreadyFinalized();
        if (results.length == 0) revert NoPlayers();

        address winner = address(0);
        for (uint256 i = 0; i < results.length; i++) {
            _results[matchId].push(results[i]);
            played[results[i].player] += 1;
            totalCracks[results[i].player] += results[i].cracksMade;
            if (results[i].slot == winnerSlot) winner = results[i].player;
        }
        if (winner == address(0)) revert WinnerNotPlaying();
        wins[winner] += 1;

        _matches[matchId] = Match({
            matchId: matchId,
            winnerSlot: winnerSlot,
            winType: winType,
            finalizedAt: uint64(block.timestamp),
            durationSeconds: durationSeconds,
            exists: true
        });
        _allMatches.push(matchId);

        emit MatchFinalized(matchId, winner, winnerSlot, winType, durationSeconds);
    }

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return _matches[matchId];
    }

    function getResults(bytes32 matchId) external view returns (PlayerResult[] memory) {
        return _results[matchId];
    }

    function matchCount() external view returns (uint256) {
        return _allMatches.length;
    }

    function matchAt(uint256 i) external view returns (bytes32) {
        return _allMatches[i];
    }
}
