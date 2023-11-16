// SPDX-License-Identifier: GPL-2.0-or-later

pragma solidity ^0.8.0;

import "@solidstate/contracts/interfaces/IERC165.sol";

/*
 *
 * @dev Interface for the Future Rewards Token Standard.
 *
 * A standardized way to receive future rewards for non-fungible tokens (NFTs.)
 *
 */
interface InFR is IERC165 {

    event FRClaimed(address indexed account, uint256 indexed amount);

    event FRDistributed(uint256 indexed tokenId, uint256 indexed allocatedFR);

    event Transferred(uint256 indexed tokenId, uint256 indexed amount, int256 indexed profit, uint256 newTokenId);

    event Listed(uint256 indexed tokenId, uint256 indexed salePrice);

    event Unlisted(uint256 indexed tokenId);

    event Bought(uint256 indexed tokenId, uint256 indexed salePrice, uint256 indexed saleAmount);

    function list(uint256 tokenId, uint256 amount, uint256 salePrice) external;

    function unlist(uint256 tokenId) external;

    function buy(uint256 tokenId, uint256 amount) payable external;

    function transferFrom(address from, address to, uint256 tokenId, uint256 amount) external;

    function approve(address operator, uint256 tokenId, uint256 amount) external;

    function releaseFR(address payable account) external;

    function getFRInfo(uint256 tokenId) external view returns(uint8, uint256, uint256, uint256, uint256, address[] memory);

    function getAllottedFR(address account) external view returns(uint256);

    function getListInfo(uint256 tokenId) external view returns(uint256, uint256, address, bool);

    function getAssetInfo(uint256 tokenId) external view returns (uint256);

    function getApprovedAmount(uint256 tokenId) external view returns (uint256);
    
}