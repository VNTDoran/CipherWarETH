// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CourierFuel
/// @notice Turns gas into a game mechanic: a courier that runs out of fuel
///         stalls mid-flight, and only a real on-chain payment restarts it.
///
/// A courier in Cipher War is, in effect, a transaction: it is dispatched, it
/// travels, and it either lands or it doesn't. This contract makes that literal.
/// Every courier leaves with a small fuel budget. When the budget runs out the
/// courier FREEZES in the ether — still fully attackable, no longer getting any
/// closer to its capital. The owner's only way to resume it is `boost()`, which
/// is a genuine wallet-signed transaction paying ETH.
///
/// That produces the pressure the design wants: your message is stuck, three
/// rivals are grinding its keys, and restarting it costs you real value right
/// now. The ETH collected is not burned — it accumulates into a per-match
/// bounty paid to the winner, so everything spent keeping messages alive
/// enlarges the prize everyone is fighting over.
contract CourierFuel is ReentrancyGuard {
    /// Price of one fuel unit. Deliberately cheap: on a local node every
    /// account holds 10 000 test ETH, and the point is the transaction, not
    /// the cost.
    uint256 public constant FUEL_UNIT_PRICE = 0.001 ether;

    /// Seconds of travel bought by one fuel unit.
    uint32 public constant SECONDS_PER_UNIT = 5;

    /// Cap per transaction, so a player cannot buy their way out of all tension.
    uint32 public constant MAX_UNITS_PER_BOOST = 6;

    /// Range of the hidden fuel demand, in units.
    uint32 public constant MIN_REQUIRED_UNITS = 4;
    uint32 public constant MAX_REQUIRED_UNITS = 15;

    struct Courier {
        address owner;
        uint32 unitsAtDispatch;
        uint32 unitsBoosted;
        uint32 requiredUnits; // hidden demand, checkable after the reveal
        uint32 boostCount;
        bool registered;
        bool landed;
    }

    address public immutable gameServer;

    mapping(bytes32 => Courier) private _couriers;
    /// matchId => ETH accumulated from boosts, waiting for the winner.
    mapping(bytes32 => uint256) public bounty;
    mapping(bytes32 => bool) public bountyPaid;

    event CourierRegistered(
        bytes32 indexed matchId,
        bytes32 indexed courierId,
        address indexed owner,
        uint32 unitsAtDispatch,
        uint32 requiredUnits
    );
    event CourierBoosted(
        bytes32 indexed matchId,
        bytes32 indexed courierId,
        address indexed payer,
        uint256 amount,
        uint32 unitsAdded,
        uint32 totalUnits,
        uint32 stillOwed
    );
    event CourierLanded(bytes32 indexed matchId, bytes32 indexed courierId);
    event BountyPaid(bytes32 indexed matchId, address indexed winner, uint256 amount);

    error NotGameServer();
    error NotCourierOwner();
    error AlreadyRegistered();
    error UnknownCourier();
    error CourierAlreadyLanded();
    error NoValueSent();
    error TooMuchFuel();
    error BountyAlreadyPaid();
    error NothingToPay();
    error TransferFailed();
    error BadRequirement();

    modifier onlyServer() {
        if (msg.sender != gameServer) revert NotGameServer();
        _;
    }

    constructor(address _gameServer) {
        require(_gameServer != address(0), "invalid server");
        gameServer = _gameServer;
    }

    function courierKey(bytes32 matchId, bytes32 courierId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(matchId, courierId));
    }

    // ────────────────────────────── Dispatch ───────────────────────────────

    /// @notice Called by the server when a courier leaves, recording who may
    ///         refuel it and how far it can travel unaided.
    /// @param requiredUnits Total fuel this courier will demand. The server
    ///        derives it from the SECRET preimage via `deriveRequiredUnits`, so
    ///        the player cannot predict it — they find out by paying until the
    ///        courier moves again, exactly like discovering a transaction's real
    ///        gas cost. It is published here only as a number, which reveals
    ///        nothing about the key; after the reveal anyone can recompute it
    ///        and confirm the server did not inflate the bill.
    function registerCourier(
        bytes32 matchId,
        bytes32 courierId,
        address owner,
        uint32 unitsAtDispatch,
        uint32 requiredUnits
    ) external onlyServer {
        bytes32 k = courierKey(matchId, courierId);
        if (_couriers[k].registered) revert AlreadyRegistered();
        if (owner == address(0)) revert NotCourierOwner();
        if (requiredUnits < MIN_REQUIRED_UNITS || requiredUnits > MAX_REQUIRED_UNITS) {
            revert BadRequirement();
        }

        _couriers[k] = Courier({
            owner: owner,
            unitsAtDispatch: unitsAtDispatch,
            unitsBoosted: 0,
            requiredUnits: requiredUnits,
            boostCount: 0,
            registered: true,
            landed: false
        });

        emit CourierRegistered(matchId, courierId, owner, unitsAtDispatch, requiredUnits);
    }

    /// @notice The fuel demand implied by a courier's secret preimage.
    /// @dev Pure and public: after `revealCourier` publishes the index and nonce,
    ///      anyone recomputes this and compares it to the stored
    ///      `requiredUnits`. A server that billed more than the draw dictated is
    ///      caught the same way a server that swapped the key is caught.
    function deriveRequiredUnits(
        bytes32 matchId,
        bytes32 courierId,
        uint8 keyIndex,
        bytes32 nonce
    ) public pure returns (uint32) {
        uint256 h = uint256(
            keccak256(abi.encodePacked("FUEL", matchId, courierId, keyIndex, nonce))
        );
        uint32 span = MAX_REQUIRED_UNITS - MIN_REQUIRED_UNITS + 1;
        return MIN_REQUIRED_UNITS + uint32(h % span);
    }

    /// @notice True if the fuel demanded matches what the revealed draw implies.
    function fuelWasHonest(
        bytes32 matchId,
        bytes32 courierId,
        uint8 keyIndex,
        bytes32 nonce
    ) external view returns (bool) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        if (!c.registered) return false;
        return c.requiredUnits == deriveRequiredUnits(matchId, courierId, keyIndex, nonce);
    }

    /// @notice Units still owed before the courier can complete its journey.
    function unitsOutstanding(bytes32 matchId, bytes32 courierId) public view returns (uint32) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        uint32 paid = c.unitsAtDispatch + c.unitsBoosted;
        if (paid >= c.requiredUnits) return 0;
        return c.requiredUnits - paid;
    }

    /// @notice True while the courier is frozen for want of fuel.
    function isStalled(bytes32 matchId, bytes32 courierId) external view returns (bool) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        if (!c.registered || c.landed) return false;
        return unitsOutstanding(matchId, courierId) > 0;
    }

    // ─────────────────────────────── Boost ─────────────────────────────────

    /// @notice Refuel a stalled courier. Signed from the player's own wallet —
    ///         this is the transaction the game is waiting on.
    /// @dev The server listens for `CourierBoosted` and resumes travel.
    function boost(bytes32 matchId, bytes32 courierId) external payable nonReentrant {
        bytes32 k = courierKey(matchId, courierId);
        Courier storage c = _couriers[k];

        if (!c.registered) revert UnknownCourier();
        if (c.landed) revert CourierAlreadyLanded();
        if (msg.sender != c.owner) revert NotCourierOwner();
        if (msg.value == 0) revert NoValueSent();

        uint32 units = uint32(msg.value / FUEL_UNIT_PRICE);
        if (units == 0) revert NoValueSent();
        if (units > MAX_UNITS_PER_BOOST) revert TooMuchFuel();

        c.unitsBoosted += units;
        c.boostCount += 1;
        bounty[matchId] += msg.value;

        emit CourierBoosted(
            matchId,
            courierId,
            msg.sender,
            msg.value,
            units,
            c.unitsAtDispatch + c.unitsBoosted,
            unitsOutstanding(matchId, courierId)
        );
    }

    /// @notice How many seconds of travel this courier has paid for in total.
    function travelSecondsOf(bytes32 matchId, bytes32 courierId) external view returns (uint32) {
        Courier storage c = _couriers[courierKey(matchId, courierId)];
        return (c.unitsAtDispatch + c.unitsBoosted) * SECONDS_PER_UNIT;
    }

    function getCourier(bytes32 matchId, bytes32 courierId) external view returns (Courier memory) {
        return _couriers[courierKey(matchId, courierId)];
    }

    /// @notice Convenience for the UI: cost in wei for a given number of units.
    function quote(uint32 units) external pure returns (uint256) {
        return uint256(units) * FUEL_UNIT_PRICE;
    }

    // ────────────────────────────── Settlement ─────────────────────────────

    function markLanded(bytes32 matchId, bytes32 courierId) external onlyServer {
        bytes32 k = courierKey(matchId, courierId);
        if (!_couriers[k].registered) revert UnknownCourier();
        _couriers[k].landed = true;
        emit CourierLanded(matchId, courierId);
    }

    /// @notice Pay the accumulated gas bounty to the winner at match end.
    function payBounty(bytes32 matchId, address winner) external onlyServer nonReentrant {
        if (bountyPaid[matchId]) revert BountyAlreadyPaid();
        uint256 amount = bounty[matchId];
        if (amount == 0) revert NothingToPay();
        if (winner == address(0)) revert NotCourierOwner();

        bountyPaid[matchId] = true;
        bounty[matchId] = 0;

        (bool ok, ) = payable(winner).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BountyPaid(matchId, winner, amount);
    }
}
