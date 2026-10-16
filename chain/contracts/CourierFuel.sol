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

    struct Courier {
        address owner;
        uint32 unitsAtDispatch;
        uint32 unitsBoosted;
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
        uint32 unitsAtDispatch
    );
    event CourierBoosted(
        bytes32 indexed matchId,
        bytes32 indexed courierId,
        address indexed payer,
        uint256 amount,
        uint32 unitsAdded,
        uint32 totalUnits
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
    function registerCourier(
        bytes32 matchId,
        bytes32 courierId,
        address owner,
        uint32 unitsAtDispatch
    ) external onlyServer {
        bytes32 k = courierKey(matchId, courierId);
        if (_couriers[k].registered) revert AlreadyRegistered();
        if (owner == address(0)) revert NotCourierOwner();

        _couriers[k] = Courier({
            owner: owner,
            unitsAtDispatch: unitsAtDispatch,
            unitsBoosted: 0,
            boostCount: 0,
            registered: true,
            landed: false
        });

        emit CourierRegistered(matchId, courierId, owner, unitsAtDispatch);
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
            c.unitsAtDispatch + c.unitsBoosted
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
