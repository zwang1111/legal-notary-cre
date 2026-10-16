// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {LegalNotary} from "../src/LegalNotary.sol";

interface Vm { function prank(address) external; function expectRevert(bytes calldata) external; function expectRevert() external; }

contract LegalNotaryTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant FWD = address(0xF0);
    LegalNotary n;
    function setUp() public { n = new LegalNotary(FWD); }
    function _report(bytes32 d) internal pure returns (bytes memory) {
        return abi.encode(d, uint8(1), uint8(92), bytes32(uint256(1)), bytes32(uint256(2)), "DE", address(0xA6E));
    }
    function testForwarderWrites() public {
        vm.prank(FWD); n.onReport(new bytes(62), _report(keccak256("doc")));
        (uint8 v, uint8 s,,, string memory j, address p, uint64 ts) = n.attestations(keccak256("doc"));
        require(v == 1 && s == 92 && p == address(0xA6E) && ts > 0 && keccak256(bytes(j)) == keccak256("DE"), "stored");
        require(n.count() == 1, "count");
    }
    function testRejectsNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(LegalNotary.NotForwarder.selector, address(this)));
        n.onReport(new bytes(62), _report(keccak256("doc")));
    }
    function testWorkflowIdLock() public {
        n.setExpectedWorkflowId(bytes32(uint256(7)));
        vm.prank(FWD); vm.expectRevert();
        n.onReport(abi.encodePacked(bytes32(uint256(8)), bytes10(0), address(0)), _report(keccak256("x")));
        vm.prank(FWD); n.onReport(abi.encodePacked(bytes32(uint256(7)), bytes10(0), address(0)), _report(keccak256("x")));
        require(n.count() == 1, "locked ok");
    }
    function testInterface() public view { require(n.supportsInterface(bytes4(keccak256("onReport(bytes,bytes)"))) && n.supportsInterface(0x01ffc9a7) && !n.supportsInterface(0xdeadbeef), "erc165"); }
}
