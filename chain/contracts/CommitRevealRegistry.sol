// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CommitRevealRegistry
/// @notice Makes the game server's secret key draw verifiable.
///
/// In Cipher War every courier carries N candidate decryption keys, exactly one
/// of which is real. Today the server picks that index privately and keeps it
/// secret for the whole flight, so players have to trust it. A dishonest server
/// could move the real key the moment someone is about to guess it.
///
/// This contract removes that trust. Before a courier becomes attackable the
/// server publishes only `keccak256(matchId, courierId, keyIndex, nonce)`:
///   - BINDING  — the server can no longer change its answer, because no other
///                input produces the same hash.
///   - HIDING   — nobody can read the index out of the hash, because the random
///                nonce makes the preimage unguessable. Without a nonce there
///                would be only N possible hashes and anyone could brute force
///                all of them instantly.
///
/// When the courier resolves, the server reveals the index and the nonce. This
/// contract recomputes the hash and REJECTS the reveal if it does not match, so
/// a lie cannot even be recorded. A server that stays silent past its deadline
/// is marked Defaulted, which is itself public evidence.
contract CommitRevealRegistry {
    enum Status {
        Unknown,    // never committed
        Committed,  // commitment published, courier in flight
        Revealed,   // revealed and the hash checked out
        Defaulted   // deadline passed with no reveal -> server failed to prove
    }

    struct Courier {
        bytes32 commitment;
        uint64 committedAt;
        uint64 revealDeadline;
        uint8 candidateCount;
        uint8 keyIndex; // meaningful only once revealed
        bytes32 nonce;  // meaningful only once revealed
        bool revealed;
    }

    /// The game server's address. Only it may commit and reveal; anyone may read.
    address public immutable gameServer;

    /// courierKey => Courier, where courierKey = keccak256(matchId, courierId).
    mapping(bytes32 => Courier) private _couriers;

    /// Running counts, so the UI can show "12 couriers proven this match".
    mapping(bytes32 => uint32) public committedCount;
    mapping(bytes32 => uint32) public revealedCount;

    event CourierCommitted(
        bytes32 indexed matchId,
        bytes32 indexed courierId,
        bytes32 commitment,
        uint8 candidateCount,
        uint64 revealDeadline
    );

    event CourierRevealed(
        bytes32 indexed matchId,
        bytes32 indexed courierId,
        uint8 keyIndex,
        bytes32 nonce
    );

    error NotGameServer();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error RevealWindowClosed();
    error BadCommitment();
    error IndexOutOfRange();
    error InvalidWindow();

    modifier onlyServer() {
        if (msg.sender != gameServer) revert NotGameServer();
        _;
    }

    constructor(address _gameServer) {
        require(_gameServer != address(0), "invalid server");
        gameServer = _gameServer;
    }

    // ─────────────────────────────── Commit ────────────────────────────────

    /// @notice Lock in the real key index BEFORE the courier can be attacked.
    /// @dev The caller hashes off-chain; the preimage never touches the chain here.
    ///      matchId and courierId are inside the hash so a commitment cannot be
    ///      replayed onto a different courier.
    function commitCourier(
        bytes32 matchId,
        bytes32 courierId,
        bytes32 commitment,
        uint8 candidateCount,
        uint64 revealWindowSeconds
    ) external onlyServer {
        if (candidateCount == 0) revert IndexOutOfRange();
        if (revealWindowSeconds == 0 || revealWindowSeconds > 1 hours) revert InvalidWindow();

        bytes32 k = courierKey(matchId, courierId);
        if (_couriers[k].commitment != bytes32(0)) revert AlreadyCommitted();

        uint64 deadline = uint64(block.timestamp) + revealWindowSeconds;
        _couriers[k] = Courier({
            commitment: commitment,
            committedAt: uint64(block.timestamp),
            revealDeadline: deadline,
            candidateCount: candidateCount,
            keyIndex: 0,
            nonce: bytes32(0),
            revealed: false
        });
        committedCount[matchId] += 1;

        emit CourierCommitted(matchId, courierId, commitment, candidateCount, deadline);
    }

    // ─────────────────────────────── Reveal ────────────────────────────────

    /// @notice Open the envelope. Reverts unless the preimage matches exactly,
    ///         so the chain can never record a false reveal.
    function revealCourier(
        bytes32 matchId,
        bytes32 courierId,
        uint8 keyIndex,
        bytes32 nonce
    ) external onlyServer {
        bytes32 k = courierKey(matchId, courierId);
        Courier storage c = _couriers[k];

        if (c.commitment == bytes32(0)) revert NotCommitted();
        if (c.revealed) revert AlreadyRevealed();
        if (block.timestamp > c.revealDeadline) revert RevealWindowClosed();
        if (keyIndex >= c.candidateCount) revert IndexOutOfRange();

        // THE check. Everything else is bookkeeping.
        if (computeCommitment(matchId, courierId, keyIndex, nonce) != c.commitment) {
            revert BadCommitment();
        }

        c.keyIndex = keyIndex;
        c.nonce = nonce;
        c.revealed = true;
        revealedCount[matchId] += 1;

        emit CourierRevealed(matchId, courierId, keyIndex, nonce);
    }

    // ──────────────────────────── Public reads ─────────────────────────────

    /// @notice The exact hash the server must produce. Anyone can call this with
    ///         the revealed values and compare it against the stored commitment.
    function computeCommitment(
        bytes32 matchId,
        bytes32 courierId,
        uint8 keyIndex,
        bytes32 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(matchId, courierId, keyIndex, nonce));
    }

    function courierKey(bytes32 matchId, bytes32 courierId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(matchId, courierId));
    }

    function getCourier(bytes32 matchId, bytes32 courierId) external view returns (Courier memory) {
        return _couriers[courierKey(matchId, courierId)];
    }

    /// @notice Lifecycle state, including the silent-server case.
    function statusOf(bytes32 matchId, bytes32 courierId) external view returns (Status) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        if (c.commitment == bytes32(0)) return Status.Unknown;
        if (c.revealed) return Status.Revealed;
        if (block.timestamp > c.revealDeadline) return Status.Defaulted;
        return Status.Committed;
    }

    /// @notice Independent re-check of a revealed courier. Returns false if the
    ///         stored preimage does not hash to the stored commitment — which
    ///         cannot happen through revealCourier, and is here so a verifier
    ///         never has to take that on faith.
    function isProven(bytes32 matchId, bytes32 courierId) external view returns (bool) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        if (!c.revealed) return false;
        return computeCommitment(matchId, courierId, c.keyIndex, c.nonce) == c.commitment;
    }
}
