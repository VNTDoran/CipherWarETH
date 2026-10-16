// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title IntelToken (INTEL)
/// @notice The in-game currency, as a real ERC-20 so it can be staked in a
///         tournament escrow and shown in MetaMask like any other token.
///
/// In Cipher War, "intel" is earned by cracking enemy couriers and spent on
/// spies, encryption and dispatching directives. That balance stays off-chain
/// during a match — it changes several times a second and belongs in server
/// memory. This token is the *settlement* layer: what players stake on the
/// outcome and what the winner is actually paid in.
///
/// A public faucet is included on purpose. On a local Hardhat node you need
/// every imported MetaMask account to hold test tokens before it can stake,
/// and asking the owner to mint for each one is tedious in a demo.
contract IntelToken is ERC20, Ownable {
    /// How much a single faucet call hands out.
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    /// Minimum delay between two faucet calls from the same address.
    uint256 public constant FAUCET_COOLDOWN = 1 minutes;

    mapping(address => uint256) public lastFaucetAt;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor(address initialOwner) ERC20("Cipher Intel", "INTEL") Ownable(initialOwner) {
        // Seed the game server so it can fund demos without the faucet.
        _mint(initialOwner, 1_000_000 ether);
    }

    /// @notice Owner mint, for seeding accounts in scripts.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone may claim test tokens, rate-limited per address.
    function faucet() external {
        uint256 availableAt = lastFaucetAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetAt[msg.sender] != 0 && block.timestamp < availableAt) {
            revert FaucetCooldown(availableAt);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Seconds remaining before this address may call the faucet again.
    function faucetCooldownLeft(address who) external view returns (uint256) {
        if (lastFaucetAt[who] == 0) return 0;
        uint256 availableAt = lastFaucetAt[who] + FAUCET_COOLDOWN;
        if (block.timestamp >= availableAt) return 0;
        return availableAt - block.timestamp;
    }
}
