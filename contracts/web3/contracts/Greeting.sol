// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Greeting {
    string public greeting;
    address public owner;

    event GreetingChanged(address indexed updatedBy, string newGreeting);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }

    constructor(string memory _greeting) {
        greeting = _greeting;
        owner = msg.sender;
    }

    function setGreeting(string memory _greeting) public {
        greeting = _greeting;
        emit GreetingChanged(msg.sender, _greeting);
    }
}
