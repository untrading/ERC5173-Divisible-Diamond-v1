// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.8;

library nFRStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("5173.diamond.NFT.nFR.contract.storage");

    struct FRInfo {
        uint8 numGenerations; // Number of generations corresponding to that Token ID
        uint256 percentOfProfit; // Percent of profit allocated for FR, scaled by 1e18
        uint256 successiveRatio; // The common ratio of successive in the geometric sequence, used for distribution calculation
        uint256 lastSoldPrice; // Last unit sale price in ETH mantissa
        uint256 ownerAmount; // Amount of owners the Token ID has seen
        address[] addressesInFR; // The addresses currently in the FR cycle
        bool isValid; // Updated by contract and signifies if an FR Info for a given Token ID is valid
    }

    struct ListInfo {
        uint256 salePrice; // ETH mantissa of the listed selling price
        uint256 saleAmount; // Amount of tokens being sold
        // uint256 maxPartial; // Max amount that can be sold partially // Though at the same time it might be easier to do bool isPartial. //? What's the use case of specifiying the maximum amount that can be sold partially in your listing?
        address lister; // Owner/Lister of the Token
        bool isListed; // Boolean indicating whether the Token is listed or not
    }

    struct AssetInfo {
        uint256 amount;
    }

    struct Layout {
        FRInfo _defaultFRInfo;
        AssetInfo _defaultAssetInfo;
        
        mapping(uint256 => FRInfo) _tokenFRInfo;

        mapping(uint256 => ListInfo) _tokenListInfo;

        mapping(uint256 => AssetInfo) _tokenAssetInfo;

        mapping(uint256 => uint256) _tokenApprovalAmounts; // tokenId => approved amount - To be used in conjunction with ERC721 _tokenApprovals.

        mapping(address => uint256) _allottedFR;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
