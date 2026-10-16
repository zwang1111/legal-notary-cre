// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Chainlink CRE receiver interface (IReceiver from the CRE templates).
interface IReceiver { function onReport(bytes calldata metadata, bytes calldata report) external; }
interface IERC165 { function supportsInterface(bytes4 id) external view returns (bool); }

/// @title LegalNotary - onchain registry of CRE-verified contract attestations.
/// @dev Only the Chainlink KeystoneForwarder (or MockKeystoneForwarder in simulation) may write.
///      Stores the document hash, never the document. Not legal advice; an audit trail.
contract LegalNotary is IReceiver, IERC165 {
    struct Attestation { uint8 verdict; uint8 score; bytes32 findingsHash; bytes32 partiesHash; string jurisdiction; address payer; uint64 timestamp; }
    address public immutable forwarder;
    address public owner;
    bytes32 public expectedWorkflowId; // optional: lock to one workflow once deployed
    mapping(bytes32 => Attestation) public attestations;
    bytes32[] public docs;

    event Notarized(bytes32 indexed docHash, uint8 verdict, uint8 score, address indexed payer, string jurisdiction);
    error NotForwarder(address sender);
    error WrongWorkflow(bytes32 got);

    constructor(address _forwarder) { require(_forwarder != address(0), "forwarder"); forwarder = _forwarder; owner = msg.sender; }

    function setExpectedWorkflowId(bytes32 id) external { require(msg.sender == owner, "owner"); expectedWorkflowId = id; }

    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        if (expectedWorkflowId != bytes32(0)) {
            bytes32 wid; assembly { wid := calldataload(metadata.offset) } // metadata = workflowId(32) | name(10) | owner(20)
            if (wid != expectedWorkflowId) revert WrongWorkflow(wid);
        }
        (bytes32 docHash, uint8 verdict, uint8 score, bytes32 fh, bytes32 ph, string memory j, address payer) =
            abi.decode(report, (bytes32, uint8, uint8, bytes32, bytes32, string, address));
        if (attestations[docHash].timestamp == 0) docs.push(docHash);
        attestations[docHash] = Attestation(verdict, score, fh, ph, j, payer, uint64(block.timestamp));
        emit Notarized(docHash, verdict, score, payer, j);
    }

    function count() external view returns (uint256) { return docs.length; }
    function supportsInterface(bytes4 id) external pure override returns (bool) {
        return id == type(IReceiver).interfaceId || id == type(IERC165).interfaceId;
    }
}
