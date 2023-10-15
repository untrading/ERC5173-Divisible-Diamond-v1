// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.8;

import "./InFR.sol";
import "./nFRStorage.sol";
import "@solidstate/contracts/token/ERC721/SolidStateERC721.sol";
import "@prb/math/contracts/PRBMathUD60x18.sol";
import "@prb/math/contracts/PRBMathSD59x18.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import { ERC721BaseStorage } from "@solidstate/contracts/token/ERC721/base/ERC721BaseStorage.sol";

import {CounterStorage} from "../utils/CounterStorage.sol";

abstract contract nFR is InFR, SolidStateERC721 {
    using PRBMathUD60x18 for uint256;
    using PRBMathSD59x18 for int256;

    using CounterStorage for CounterStorage.Layout;

    function getFRInfo(uint256 tokenId)
        external
        view
        virtual
        override
        returns (
            uint8 numGenerations,
            uint256 percentOfProfit,
            uint256 successiveRatio,
            uint256 lastSoldPrice,
            uint256 ownerAmount,
            address[] memory addressesInFR
        )
    {
        nFRStorage.Layout storage l = nFRStorage.layout();
        return (l._tokenFRInfo[tokenId].numGenerations, l._tokenFRInfo[tokenId].percentOfProfit, l._tokenFRInfo[tokenId].successiveRatio, l._tokenFRInfo[tokenId].lastSoldPrice, l._tokenFRInfo[tokenId].ownerAmount, l._tokenFRInfo[tokenId].addressesInFR);
    }

    function getListInfo(uint256 tokenId)
        external
        view
        virtual
        override
        returns (
            uint256,
            uint256,
            address,
            bool
        )
    {
        nFRStorage.Layout storage l = nFRStorage.layout();
        return (l._tokenListInfo[tokenId].salePrice, l._tokenListInfo[tokenId].saleAmount, l._tokenListInfo[tokenId].lister, l._tokenListInfo[tokenId].isListed);
    }

    function getAssetInfo(uint256 tokenId) 
        external
        view
        virtual
        override
        returns (
            uint256,
            uint256
        )
    {
        nFRStorage.Layout storage l = nFRStorage.layout();
        return (l._tokenAssetInfo[tokenId].amount, l._tokenAssetInfo[tokenId].initialAmount);
    }

    function getAllottedFR(address account) external view virtual override returns (uint256) {
        nFRStorage.Layout storage l = nFRStorage.layout();
        return l._allottedFR[account];
    }

    function getApprovedAmount(uint256 tokenId) external view virtual returns(uint256) {
        nFRStorage.Layout storage l = nFRStorage.layout();

        return l._tokenApprovalAmounts[tokenId];
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId, uint256 amount) internal view virtual returns (bool) {
        nFRStorage.Layout storage l = nFRStorage.layout();

        if (!_exists(tokenId)) revert ERC721Base__NonExistentToken();

        address owner = _ownerOf(tokenId);

        return (
            (spender == owner) ||
            (_getApproved(tokenId) == spender && l._tokenApprovalAmounts[tokenId] >= amount) ||
            (_isApprovedForAll(owner, spender))
        );
    }

    function list(uint256 tokenId, uint256 amount, uint256 salePrice) public virtual override {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "ERC5173: list caller is not owner nor approved");
        nFRStorage.Layout storage l = nFRStorage.layout();

        require(amount <= l._tokenAssetInfo[tokenId].amount, "amount is too large");

        l._tokenListInfo[tokenId] = nFRStorage.ListInfo(salePrice, amount, _msgSender(), true);

        emit Listed(tokenId, salePrice);
    }

    function unlist(uint256 tokenId) public virtual override {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "ERC5173: unlist caller is not owner nor approved");
        nFRStorage.Layout storage l = nFRStorage.layout();

        delete l._tokenListInfo[tokenId];

        emit Unlisted(tokenId);
    }

    function buy(uint256 tokenId, uint256 amount) public payable virtual override { //? Maybe add a *to* parameter
        _buy(tokenId, amount, false);
    }

    function _buy(uint256 tokenId, uint256 amount, bool bypassValueCheck) internal virtual { //* The boolean is for custom msg.value checks or different payment methods (such as ERC20)
        nFRStorage.Layout storage l = nFRStorage.layout();
        require(l._tokenListInfo[tokenId].isListed == true, "Token is not listed");
        require(amount <= l._tokenListInfo[tokenId].saleAmount, "Buy amount exceeds list amount");

        uint256 salePrice = ((amount).div(l._tokenListInfo[tokenId].saleAmount)).mul(l._tokenListInfo[tokenId].salePrice); // Sale price should be determined based on the amount supplied into the buy function, (buyAmount/saleAmount) * salePrice

        require(bypassValueCheck || salePrice == msg.value, "salePrice and msg.value mismatch");

        _transferFrom(l._tokenListInfo[tokenId].lister, _msgSender(), tokenId, amount, salePrice);

        emit Bought(tokenId, salePrice, amount);
    }

    function transferFrom(address from, address to, uint256 tokenId, uint256 amount) public virtual {
        require(_isApprovedOrOwner(_msgSender(), tokenId, amount), "caller is not owner nor approved");

        _transfer(from, to, tokenId, amount);
    }

    function approve(address operator, uint256 tokenId, uint256 amount) public virtual {
        nFRStorage.Layout storage l = nFRStorage.layout();

        require(amount <= l._tokenAssetInfo[tokenId].amount, "Approval amount exceeds asset amount");

        ERC721BaseInternal._approve(operator, tokenId); // ERC721 approve handles the remaining logic

        l._tokenApprovalAmounts[tokenId] = amount;
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view virtual override returns (bool) {
        nFRStorage.Layout storage l = nFRStorage.layout();

        return (_isApprovedOrOwner(spender, tokenId, l._tokenAssetInfo[tokenId].amount)); // ERC721 call, so either approved with ERC721 method or max amount
    }

    function _approve(address operator, uint256 tokenId) internal virtual override {
        super._approve(operator, tokenId);

        nFRStorage.Layout storage l = nFRStorage.layout();

        l._tokenApprovalAmounts[tokenId] = l._tokenAssetInfo[tokenId].amount;
    }

    function _transfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal virtual {
        _transferFrom(from, to, tokenId, amount, 0); // 0 sold price as it is just a transfer.
    }

    function _transfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override {
        nFRStorage.Layout storage l = nFRStorage.layout();

        _transfer(from, to, tokenId, l._tokenAssetInfo[tokenId].amount);
    }

    function _transferFrom(address from, address to, uint256 tokenId, uint256 amount, uint256 soldPrice) internal virtual {
        require(from != to, "transfer to self");
        nFRStorage.Layout storage l = nFRStorage.layout();

        require(amount <= l._tokenAssetInfo[tokenId].amount, "amount is too large"); //* This check is done in list, however, when other transfer functions are calling it there is no guard. So this serves as one.

        for (uint i = 0; i < l._tokenFRInfo[tokenId].addressesInFR.length; i++) { // Could use an isInFR mapping if it is cheaper
            require(l._tokenFRInfo[tokenId].addressesInFR[i] != to, "Already in the FR sliding window");
        }

        uint256 allocatedFR = 0;

        // Could make the profit formula a helper function in the nFRStorage library
        int256 profit = ((int256(soldPrice).div(int256(amount))) - (int256(l._tokenFRInfo[tokenId].lastSoldPrice).div(int256(l._tokenAssetInfo[tokenId].initialAmount)))).mul(int256(amount)); // All values are uints, however, when doing these calculations we need ints because they have the potential to be negatives/"underflow" if a tx is unprofitable. ((Current Sale Price / Current Sale Amount) - (Last Sold Price / Initial Amount)) * Current Sale Amount | (Current Sale Price - Last Sale Price) / (Initial Token Amount / Sale Amount) - If we don't have initial token amount, then you can't properly calculate the profits. If you sell half of the token, then the other half, it'll be as if you made 1.5x of your actual profits. A new formula might look like (Current Sale Price / Current Sale Amount) - (Last Sold Price / Initial Amount). I bought 5 tokens for 10 ETH (2 ETH Unit Price), then I sold 1 token for 5 ETH (5 ETH Unit Price). I made 3 ETH. (5/1) - (10/5) = 3. This formula seems to only work if the amount being sold is not equal to the initial amount, if it is equal we must use one of two formuals, either the same formula multiplied by the amount being sold: ((Current Sale Price / Current Sale Amount) - (Last Sold Price / Initial Amount)) * Current Sale Amount. Or the old formula: (Current Sale Price - Last Sale Price) / (Initial Token Amount / Sale Amount). This new formula should work with both whole sales and fractional sales: ((Current Sale Price / Current Sale Amount) - (Last Sold Price / Initial Amount)) * Current Sale Amount.

        if (profit > 0) { // NFT sold for a profit
            allocatedFR = _distributeFR(tokenId, soldPrice, uint256(profit));
        }

        uint256 newTokenId; //? Do we even need this if we aren't using it anywhere?

        if (amount != l._tokenAssetInfo[tokenId].amount) {
            // Mint a new token that clones the FR info, then deducts the amount from the current token, then we set the newTokenId
            newTokenId = _createSplitToken(to, tokenId, amount, soldPrice);

            l._tokenAssetInfo[tokenId].amount -= amount;

            ERC721BaseStorage.layout().tokenApprovals[tokenId] = address(0); // Remove approved address on partial transfer, it is already removed on whole transfer by ERC721 transfer
        } else {
            // Whole NFT has been transferred
            ERC721BaseInternal._transfer(from, to, tokenId);
            require(_checkOnERC721Received(from, to, tokenId, ""), "ERC721: transfer to non ERC721Receiver implementer");

            l._tokenFRInfo[tokenId].lastSoldPrice = soldPrice; // Should not be updating this if the transfer is not whole. Otherwise, you can sell 0.1 tokens at 1000, then sell 0.9 tokens at 1000 paying 0 FR.
            l._tokenFRInfo[tokenId].ownerAmount++;

            _shiftGenerations(to, tokenId);
        }

        l._tokenApprovalAmounts[tokenId] = 0; // Reset token approvals on transfer, I don't believe we need a decrementing system as the approvals are meant to be more of a one-off type of transaction, if an approved address is to make more than a couple transactions, they should be approved with setApprovalForAll. Though if there is a need, this could be easily changed to a decrement system as it is just how you modify storage slots and is implementation related.

        address lister = l._tokenListInfo[tokenId].lister;

        if (l._tokenListInfo[tokenId].isListed && amount < l._tokenListInfo[tokenId].saleAmount) { // If the token sold a partial amount
            l._tokenListInfo[tokenId].salePrice -= soldPrice;
            l._tokenListInfo[tokenId].saleAmount -= amount;
        } else { // If the entire list was fulfilled or the token isn't listed, delete everything
            delete l._tokenListInfo[tokenId];
        }

        if (soldPrice > 0)
            _payLister(tokenId, lister, soldPrice - allocatedFR);
    }

    function _payLister(uint256 /*tokenId*/, address lister, uint256 paymentAmount) internal virtual { //* This function is for custom payment logic or different payment methods (such as ERC20), it allows overriding the payment logic.
        (bool sent, ) = payable(lister).call{value: paymentAmount}(""); // This (push) is more convenient for the user and is safe enough, if a contract that doesn't accept ether lists a token and it fails in this function, it is not detrimental to the rest of the contract.
        require(sent, "ERC5173: Failed to send ETH to lister");
    }

    function _createSplitToken(address to, uint256 tokenId, uint256 amount, uint256 soldPrice) internal virtual returns (uint256) {
        uint256 newTokenId = _incrementSplitTokenId();

        nFRStorage.Layout storage l = nFRStorage.layout();

        nFRStorage.FRInfo memory tokenFRInfo = l._tokenFRInfo[tokenId]; // Needed or else Stack Too Deep error

        _mint(to, newTokenId, amount, tokenFRInfo.numGenerations, tokenFRInfo.percentOfProfit, tokenFRInfo.successiveRatio, soldPrice, tokenFRInfo.ownerAmount + 1, tokenFRInfo.addressesInFR);

        return newTokenId;
    }

    function _incrementSplitTokenId() internal virtual returns (uint256) { //* Inheriting contracts should override this function, unless using the same Counter Storage at the same storage slot
        CounterStorage.incrementTokenId();

        return CounterStorage.currentTokenId();
    }

    function _mint(address to, uint256 tokenId) internal virtual override { // On a side note, do we even need default info? We could just revert on this function call
        nFRStorage.Layout storage l = nFRStorage.layout();

        require(l._defaultFRInfo.isValid, "No Default FR Info has been set");
        require(l._defaultAssetInfo.amount > 0, "No Default Asset Info has been set");

        super._mint(to, tokenId);

        l._tokenFRInfo[tokenId] = nFRStorage.FRInfo(l._defaultFRInfo.numGenerations, l._defaultFRInfo.percentOfProfit, l._defaultFRInfo.successiveRatio, 0, 1, new address[](0), true);

        l._tokenFRInfo[tokenId].addressesInFR.push(to);

        l._tokenAssetInfo[tokenId] = l._defaultAssetInfo;
    }

    function _mint(
        address to,
        uint256 tokenId,
        uint256 amount,
        uint8 numGenerations,
        uint256 percentOfProfit,
        uint256 successiveRatio
    ) internal virtual {
        _mint(to, tokenId, amount, numGenerations, percentOfProfit, successiveRatio, 0, 1, new address[](0));
    }

    function _mint(
        address to,
        uint256 tokenId,
        uint256 amount,
        uint8 numGenerations,
        uint256 percentOfProfit,
        uint256 successiveRatio,
        uint256 lastSoldPrice,
        uint256 ownerAmount,
        address[] memory addressesInFR
    ) internal virtual {
        require(numGenerations > 0 && percentOfProfit > 0 && percentOfProfit <= 1e18 && successiveRatio > 0 && amount > 0 && ownerAmount > 0, "Invalid Data Passed");

        ERC721BaseInternal._mint(to, tokenId);
        require(_checkOnERC721Received(address(0), to, tokenId, ""), "ERC721: transfer to non ERC721Receiver implementer");

        nFRStorage.Layout storage l = nFRStorage.layout();

        l._tokenFRInfo[tokenId] = nFRStorage.FRInfo(numGenerations, percentOfProfit, successiveRatio, lastSoldPrice, ownerAmount, addressesInFR, true);

        _shiftGenerations(to, tokenId); // Functionally equivalent to pushing addressInFR, however, takes into account calls providing a non-empty addressesInFR

        l._tokenAssetInfo[tokenId].initialAmount = amount;
        l._tokenAssetInfo[tokenId].amount = amount;
    }

    function _distributeFR(uint256 tokenId, uint256 soldPrice, uint256 profit) internal virtual returns(uint256 allocatedFR) {
        nFRStorage.Layout storage l = nFRStorage.layout();

        if (l._tokenFRInfo[tokenId].ownerAmount == 1) // Make sure the minter isn't paying themselves.
            return 0;
   
        uint256[] memory FR = _calculateFR(profit, l._tokenFRInfo[tokenId].percentOfProfit, l._tokenFRInfo[tokenId].successiveRatio, l._tokenFRInfo[tokenId].ownerAmount - 1, l._tokenFRInfo[tokenId].numGenerations - 1); // Deduct one from numGenerations and ownerAmount because otherwise it'll create the distribution with an extra person in mind, therefore, paying the newest person in the FR cycle who has just sold.

        for (uint owner = 0; owner < FR.length; owner++) {
            _allocateFR(tokenId, l._tokenFRInfo[tokenId].addressesInFR[owner], FR[owner]);
        }

        allocatedFR = profit.mul(l._tokenFRInfo[tokenId].percentOfProfit);

        emit FRDistributed(tokenId, soldPrice, allocatedFR);
    }

    function _allocateFR(uint256 /*tokenId*/, address owner, uint256 FR) internal virtual {
        nFRStorage.layout()._allottedFR[owner] += FR;
    }

    function _shiftGenerations(address to, uint256 tokenId) internal virtual {
        nFRStorage.Layout storage l = nFRStorage.layout();

        address[] storage addressesInFR = l._tokenFRInfo[tokenId].addressesInFR;

        if (addressesInFR.length < l._tokenFRInfo[tokenId].numGenerations) { // We just want to push to the array
            addressesInFR.push(to);
        } else { // We want to remove the first element in the array and then push to the end of the array
            for (uint i = 0; i < addressesInFR.length-1; i++) {
                addressesInFR[i] = addressesInFR[i+1];
            }

            addressesInFR[addressesInFR.length-1] = to; // Functionally equivalent to popping then pushing.
        }
    }

    function _setDefaultFRInfo(
        uint8 numGenerations,
        uint256 percentOfProfit,
        uint256 successiveRatio
    ) internal virtual { // If we decide to scrap defaults then we should delete this func and _setDefaultAssetInfo
        require(numGenerations > 0 && percentOfProfit > 0 && percentOfProfit <= 1e18 && successiveRatio > 0, "Invalid Data Passed");
        nFRStorage.Layout storage l = nFRStorage.layout();

        l._defaultFRInfo.numGenerations = numGenerations;
        l._defaultFRInfo.percentOfProfit = percentOfProfit;
        l._defaultFRInfo.successiveRatio = successiveRatio;
        l._defaultFRInfo.isValid = true;
    }

    function _setDefaultAssetInfo(uint256 amount) internal virtual { // Delete func if we end up scraping defaults
        require(amount > 0, "Invalid Data Passed");
        nFRStorage.Layout storage l = nFRStorage.layout();

        l._defaultAssetInfo.initialAmount = amount;
        l._defaultAssetInfo.amount = amount;
    }

    function _burn(uint256 tokenId) internal virtual override {
        super._burn(tokenId);
        nFRStorage.Layout storage l = nFRStorage.layout();

        delete l._tokenFRInfo[tokenId];
        delete l._tokenListInfo[tokenId];
        delete l._tokenAssetInfo[tokenId];
        delete l._tokenApprovalAmounts[tokenId];
    }

    function releaseFR(address payable account) public virtual override {
        nFRStorage.Layout storage l = nFRStorage.layout();
        require(l._allottedFR[account] > 0, "No FR Payment due");

        uint256 FRAmount = l._allottedFR[account];

        l._allottedFR[account] = 0;

        (bool sent, ) = account.call{value: FRAmount}("");
        require(sent, "Failed to release FR");

        emit FRClaimed(account, FRAmount);
    }

    function _calculateFR(
        uint256 totalProfit,
        uint256 buyerReward,
        uint256 successiveRatio,
        uint256 ownerAmount,
        uint256 windowSize
    ) internal pure virtual returns (uint256[] memory) {
        uint256 n = Math.min(ownerAmount, windowSize);
        uint256[] memory FR = new uint256[](n);

        for (uint256 i = 1; i < n + 1; i++) { // There have to be some optimizations we could make
            uint256 pi = 0;

            if (successiveRatio != 1e18) {
                int256 v1 = 1e18 - int256(successiveRatio).powu(n);
                int256 v2 = int256(successiveRatio).powu(i - 1);
                int256 v3 = int256(totalProfit).mul(int256(buyerReward));
                int256 v4 = v3.mul(1e18 - int256(successiveRatio));
                pi = uint256(v4 * v2 / v1);
            } else {
                pi = totalProfit.mul(buyerReward).div(n);
            }

            FR[n - i] = pi;
        }

        return FR;
    }

    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}
