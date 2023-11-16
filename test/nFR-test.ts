import { NFRFacet } from '../typechain-types/contracts';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { expect } from "chai";
import { ethers } from "hardhat";

import { Selectors, FacetCutAction } from './libraries/diamond';
import { getTXCost } from './libraries/txUtils';

import { div, mul } from "@prb/math";

type FRInfo = [
	number,
	ethers.BigNumber,
	ethers.BigNumber,
	ethers.BigNumber,
	ethers.BigNumber,
	string[]
];
  
type ListInfo = [ethers.BigNumber, ethers.BigNumber, string, boolean];
  
type AssetInfo = ethers.BigNumber;

describe("nFR implementation contract", function() {

	const tokenAmount = ethers.utils.parseUnits("1");

	const numGenerations = 10;

	const percentOfProfit = ethers.utils.parseUnits("0.16");

	const successiveRatio = ethers.utils.parseUnits("1.19");

	const baseSale = ethers.utils.parseUnits("1");

	const saleIncrementor = "0.5";

	const tokenId = 1;

	const transferAmount = ethers.utils.parseUnits("0.5");

	let nFRFactory;
	let nFR: NFRFacet;
	let owner: SignerWithAddress;
	let addrs: SignerWithAddress[];

	beforeEach(async function() {
		nFRFactory = await ethers.getContractFactory("nFRDiamond");
		[owner, ...addrs] = await ethers.getSigners();

		const nfr = await nFRFactory.deploy("unTrading Shared Contract", "unNFT", "");
		await nfr.deployed();

		const nFRFacetFactory = await ethers.getContractFactory("nFRFacet");
		const nFRFacet = await nFRFacetFactory.deploy();
		await nFRFacet.deployed();

		const cut = [{ target: nFRFacet.address, action: FacetCutAction.Add, selectors: new Selectors(nFRFacet).remove(['supportsInterface(bytes4)']) }];
		await nfr.diamondCut(cut, ethers.constants.AddressZero, "0x");

		nFR = await ethers.getContractAt('nFRFacet', nfr.address);

		await nFR.mintNFT(owner.address, tokenAmount, numGenerations, percentOfProfit, successiveRatio, "");
	});

	describe("Deployment and Retrieval", function() {
		it("Should mint to the proper owner", async function() {
			expect(await nFR.ownerOf(tokenId)).to.equal(owner.address);
		});

		it("Should set and get the correct FR info", async function() {
			let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("1"), [owner.address]]; // ..., lastSoldPrice, ownerAmount, addressesInFR
			expect(await nFR.getFRInfo(tokenId)).to.deep.equal(expectedArray);
		});

		it("Should return the proper allotted FR", async function() {
			expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.BigNumber.from("0"));
		});

		it("Should return the proper list info", async function() {
			expect(await nFR.getListInfo(tokenId)).to.deep.equal([ ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
		});

		it("Should have proper asset info", async () => {
			expect(await nFR.getAssetInfo(tokenId)).to.equal(tokenAmount);
		});

	});

	describe("ERC721 Transactions", function() {
		describe("Minting", () => {
			describe("Reverts", () => {
				it("Should fail mint without default FR info", async function() {
					await expect(nFR.mintERC721(owner.address, "")).to.be.revertedWith("No Default FR Info has been set");
				});

				it("Should fail mint without default Asset info", async function() {
					await nFR.setDefaultFRInfo(numGenerations, percentOfProfit, successiveRatio);
					await expect(nFR.mintERC721(owner.address, "")).to.be.revertedWith("No Default Asset Info has been set");
				});
			})

			it("Should successfully set default FR and Asset info and mint", async function() {
				await nFR.setDefaultFRInfo(numGenerations, percentOfProfit, successiveRatio);
				await nFR.setDefaultAssetInfo(tokenAmount);
				await nFR.mintERC721(owner.address, "")
				expect(await nFR.ownerOf("2")).to.equal(owner.address);

				expect(await nFR.getFRInfo("2")).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("1"), [owner.address] ]);
				expect(await nFR.getAssetInfo("2")).to.deep.equal(tokenAmount);
			});
		})

		describe("Transfer", () => {
			describe("Reverts", () => {
				it("Should revert if recipient is already in the FR sliding window", async () => {
					await nFR['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId);
		
					let signer = await nFR.connect(addrs[0]);
		
					await expect(signer['safeTransferFrom(address,address,uint256)'](addrs[0].address, owner.address, tokenId)).to.be.revertedWith("Already in the FR sliding window");
				});
				
				it("Should revert if transfer to self", async () => {
					await expect(nFR['safeTransferFrom(address,address,uint256)'](owner.address, owner.address, tokenId)).to.be.revertedWith("transfer to self");
				});
			})

			it("Should treat ERC721 transfer as an unprofitable sale and update data accordingly", async function() {
				await nFR['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId);
	
				let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address]];
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal(expectedArray);
			});
	
			it("Should shift generations properly even if there have only been ERC721 transfers", async function() {
				await nFR['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId);
	
				for (let transfers = 0; transfers < 9; transfers++) { // This results in 11 total owners, minter, transfer, 9 more transfers.
					let signer = nFR.connect(addrs[transfers]);
	
					await signer['safeTransferFrom(address,address,uint256)'](addrs[transfers].address, addrs[transfers + 1].address, tokenId);
				}
	
				let expectedArray: FRInfo = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("11"), []];
	
				for (let a = 0; a < 10; a++) {
					expectedArray[5].push(addrs[a].address);
				}
	
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal(expectedArray);
	
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.BigNumber.from("0"));
			});
		})

		describe("Burning", () => {
			it("Should delete FR and Asset info upon burning of NFT", async function() {
				await nFR.burnNFT(tokenId);
	
				let expectedArray: FRInfo = [0, ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), []];
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal(expectedArray);

				expect(await nFR.getAssetInfo(tokenId)).to.deep.equal(ethers.BigNumber.from("0"));
			});
		})
	});

	describe("nFR Transactions", function() {
		describe("Reverts", () => {
			describe("Minting", () => {
				it("Should fail with invalid data passed", async () => {
					await expect(nFR.mintNFT(owner.address, 0, numGenerations, percentOfProfit, successiveRatio, "")).to.be.revertedWith("Invalid Data Passed");
					await expect(nFR.mintNFT(owner.address, tokenAmount, 0, percentOfProfit, successiveRatio, "")).to.be.revertedWith("Invalid Data Passed");
					await expect(nFR.mintNFT(owner.address, tokenAmount, numGenerations, 0, successiveRatio, "")).to.be.revertedWith("Invalid Data Passed");
					await expect(nFR.mintNFT(owner.address, tokenAmount, numGenerations, percentOfProfit, 0, "")).to.be.revertedWith("Invalid Data Passed");
				});
			});

			describe("List", () => {
				it("Should fail list if not owner", async function() {
					let signer = nFR.connect(addrs[0]);
		
					await expect(signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"))).to.be.revertedWith("ERC5173: list caller is not owner nor approved");
				});
	
				it("Should fail list if list amount is greater than asset amount", async () => {
					await expect(nFR.list(tokenId, tokenAmount.add(1), ethers.utils.parseUnits("1"))).to.be.revertedWith("amount is too large");
				});
		
				it("Should fail unlist if not owner", async function() {
					let signer = nFR.connect(addrs[0]);
		
					await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
		
					await expect(signer.unlist(tokenId)).to.be.revertedWith("ERC5173: unlist caller is not owner nor approved");
				});
			})
			
			describe("Buy", () => {
				it("Should revert buy if NFT is not listed", async function() {
					let signer = nFR.connect(addrs[0]);
		
					await expect(signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("0.5") })).to.be.revertedWith("Token is not listed");
				});
		
				it("Should revert buy if msg.value is not equal to salePrice", async function() {
					let signer = nFR.connect(addrs[0]);
		
					await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
		
					await expect(signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("0.5") })).to.be.revertedWith("salePrice and msg.value mismatch");
				});
	
				it("Should revert buy if buy amount is greater than sale amount", async () => {
					let signer = nFR.connect(addrs[0]);
		
					await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
		
					await expect(signer.buy(tokenId, tokenAmount.add(1), { value: ethers.utils.parseUnits("1") })).to.be.revertedWith("Buy amount exceeds list amount");
				});

				it("Should revert if buyer is already in the FR sliding window", async () => {
					await nFR.list(tokenId, tokenAmount, baseSale);
		
					let buyer = await nFR.connect(addrs[0]);
		
					await buyer.buy(tokenId, tokenAmount, { value: baseSale });
		
					await buyer.list(tokenId, tokenAmount, baseSale.add(ethers.utils.parseUnits(saleIncrementor)));
		
					await expect(nFR.buy(tokenId, tokenAmount, { value: baseSale.add(ethers.utils.parseUnits(saleIncrementor)) })).to.revertedWith("Already in the FR sliding window");
				});
			})
	
			describe("Default FR Info", () => {
				it("Should fail if improper data passed to default FR info", async function() {
					await expect(nFR.setDefaultFRInfo("0", percentOfProfit, successiveRatio)).to.be.revertedWith("Invalid Data Passed");
					await expect(nFR.setDefaultFRInfo(numGenerations, ethers.utils.parseUnits("2"), successiveRatio)).to.be.revertedWith("Invalid Data Passed");
					await expect(nFR.setDefaultFRInfo(numGenerations, percentOfProfit, ethers.utils.parseUnits("0"))).to.be.revertedWith("Invalid Data Passed");
				});	
			})
		});

		describe("Listing", () => {
			it("Should list properly", async function() {
				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
	
				expect(await nFR.getListInfo(tokenId)).to.deep.equal([ ethers.utils.parseUnits("1"), tokenAmount, owner.address, true ]);
			});
	
			it("Should unlist properly", async function() {
				await nFR.unlist(tokenId);
	
				expect(await nFR.getListInfo(tokenId)).to.deep.equal([ ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
			});
		});

		describe("Fractional Transactions", () => {
			it("Should treat a profitable transaction properly", async function() {
				let signer = nFR.connect(addrs[0]);
	
				let balanceBefore = await ethers.provider.getBalance(addrs[0].address);
	
				let expectedBalance = balanceBefore.sub(ethers.utils.parseUnits("0.5"));
	
				await nFR.list(tokenId, transferAmount, ethers.utils.parseUnits("1"));
	
				let tx = await signer.buy(tokenId, transferAmount, {
					value: ethers.utils.parseUnits("0.5")
				});
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.equal(expectedBalance.sub(await getTXCost(tx)));
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0"), ethers.BigNumber.from("1"), [owner.address] ]);
				expect(await nFR.getFRInfo(tokenId + 1)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address] ]); 

				/* Below Here is Messy - but essentially we are testing the fractional profit calculation, we bought bought an NFT, which was at a unit price of 1.5, then we buy half at a unit price of 1.6, which is a 0.05 profit, 16% of that, is then 0.008, which is correct, the contract works exactly like that. */
	
				balanceBefore = await ethers.provider.getBalance(addrs[1].address);
	
				expectedBalance = balanceBefore.sub(ethers.utils.parseUnits("0.75"));
	
				let sellerExpectedBalance = (await ethers.provider.getBalance(addrs[0].address)).add(ethers.utils.parseUnits("0.5"));
	
				tx = await signer.list(tokenId + 1, transferAmount, ethers.utils.parseUnits("1.5"));

				sellerExpectedBalance = sellerExpectedBalance.sub(await getTXCost(tx))
	
				let buyer = nFR.connect(addrs[1]);
				
				tx = await buyer.buy(tokenId + 1, transferAmount, {
					value: ethers.utils.parseUnits("0.75")
				});

				expectedBalance = expectedBalance.sub(await getTXCost(tx));

				tx = await buyer.list(tokenId + 1, transferAmount.div(2), ethers.utils.parseUnits("1.6"));

				expectedBalance = expectedBalance.sub(await getTXCost(tx));
				
				let buyer2 = nFR.connect(addrs[2]);

				let oldContractBalance = await ethers.provider.getBalance(nFR.address);

				await buyer2.buy(tokenId + 1, transferAmount.div(2), {
					value: ethers.utils.parseUnits("0.4")
				});

				expectedBalance = expectedBalance.add(ethers.utils.parseUnits("0.4")).sub(mul(ethers.utils.parseUnits("0.025"), percentOfProfit)); // ((0.9/0.25) - (1.5/0.5)) * 0.25 = 0.15

				expect(await ethers.provider.getBalance(nFR.address)).to.be.above(oldContractBalance);
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.above(sellerExpectedBalance);
				expect(await ethers.provider.getBalance(addrs[1].address)).to.equal(expectedBalance);
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0.044")); // (0.25 * 0.16) + (0.025 * 0.16) = 0.044
				expect(await nFR.getAllottedFR(owner.address)).to.be.above(ethers.utils.parseUnits("0.04")); // 2 payments
				expect(await nFR.getAllottedFR(addrs[0].address)).to.be.above(ethers.utils.parseUnits("0")); // 1 payment
				expect(await nFR.getAllottedFR(addrs[1].address)).to.equal(ethers.utils.parseUnits("0")); // No payments
				expect(await nFR.getAllottedFR(addrs[2].address)).to.equal(ethers.utils.parseUnits("0")); // No payments
				expect(await nFR.getFRInfo(tokenId + 1)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1.5"), ethers.BigNumber.from("3"), [ owner.address, addrs[0].address, addrs[1].address ] ]);
				expect(await nFR.getFRInfo(tokenId + 2)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1.6"), ethers.BigNumber.from("4"), [ owner.address, addrs[0].address, addrs[1].address, addrs[2].address ] ]);
				expect(await nFR.getAssetInfo(tokenId)).to.equal(ethers.utils.parseUnits("0.5"));

				expect(await nFR.getAssetInfo(tokenId + 1)).to.equal(ethers.utils.parseUnits("0.25"));
				expect(await nFR.getAssetInfo(tokenId + 2)).to.equal(ethers.utils.parseUnits("0.25"));
			});
	
			it("Should treat an unprofitable transaction properly", async function() {
				let signer = await nFR.connect(addrs[0]);
	
				await nFR.list(tokenId, transferAmount, ethers.utils.parseUnits("1"));
	
				await signer.buy(tokenId, transferAmount, {
					value: ethers.utils.parseUnits("0.5")
				});
	
				let secondSigner = await nFR.connect(addrs[1]);
	
				let balanceBefore = await ethers.provider.getBalance(addrs[0].address);
	
				await signer.list(tokenId + 1, transferAmount, ethers.utils.parseUnits("0.5"));
	
				await secondSigner.buy(tokenId + 1, transferAmount, { value: ethers.utils.parseUnits("0.25") });
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.above(balanceBefore.add(ethers.utils.parseUnits("0.25")).sub(ethers.utils.parseUnits("0.001")));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId + 1)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0.5"), ethers.BigNumber.from("3"), [owner.address, addrs[0].address, addrs[1].address] ]);

				balanceBefore = await ethers.provider.getBalance(addrs[1].address);

				let thirdSigner = await nFR.connect(addrs[2]);

				await secondSigner.list(tokenId + 1, transferAmount.div(2), ethers.utils.parseUnits("0.48"));

				await thirdSigner.buy(tokenId + 1, transferAmount.div(2), { value: ethers.utils.parseUnits("0.12")});

				expect(await ethers.provider.getBalance(addrs[1].address)).to.be.above(balanceBefore.add(ethers.utils.parseUnits("0.12")).sub(ethers.utils.parseUnits("0.001")));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId + 2)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0.48"), ethers.BigNumber.from("4"), [owner.address, addrs[0].address, addrs[1].address, addrs[2].address] ]);
			});

			it("Should run through 10 FR Generations successfully", async () => {
				let buyAmount = tokenAmount.div(2);
				let currentTokenId = tokenId;

				await nFR.list(currentTokenId, buyAmount, baseSale);
	
				let s = nFR.connect(addrs[0]);
	
				await s.buy(currentTokenId, buyAmount, { value: mul(baseSale, buyAmount) });

				currentTokenId++;

				let expectedContractBalance = ethers.utils.parseUnits("0");

				for (let transfers = 0; transfers < 9; transfers++) { // This results in 11 total owners, minter, transfer, 9 more transfers.
					let signer = nFR.connect(addrs[transfers]);
					let secondSigner = nFR.connect(addrs[transfers + 1]);
					buyAmount = buyAmount.div(2);
	
					let salePrice = (await nFR.getFRInfo(currentTokenId))[3].add(ethers.utils.parseUnits(saleIncrementor)); // Get lastSoldPrice and add incrementor
	
					await signer.list(currentTokenId, buyAmount, salePrice);
	
					await secondSigner.buy(currentTokenId, buyAmount, { value: mul(salePrice, buyAmount) });

					expectedContractBalance = expectedContractBalance.add(mul(percentOfProfit, (mul(ethers.utils.parseUnits(saleIncrementor), buyAmount))));

					currentTokenId++;
				}
	
				let expectedArray: FRInfo = [numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("5.5"), ethers.BigNumber.from("11"), []]; // [3] = 5.5 because 1 [initial sale] +  9 * 0.5 [9 sales of 0.5 (11th holder didn't sell, so there were only 10 sales incl minter)] | [4] = 11 because minter + 10 owners
	
				for (let a = 0; a < 10; a++) {
					expectedArray[5].push(addrs[a].address);
				}
	
				expect(await nFR.getFRInfo(currentTokenId)).to.deep.equal(expectedArray);

				expect(await nFR.getAssetInfo(currentTokenId)).to.equal(ethers.utils.parseUnits("0.0009765625"));

				expect(await nFR.getAssetInfo(tokenId)).to.equal(ethers.utils.parseUnits("0.5"));
	
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(expectedContractBalance);
	
				let totalOwners = [owner.address, ...expectedArray[5]];
	
				let allottedFRs = [];
	
				for (let o of totalOwners) allottedFRs.push(await nFR.getAllottedFR(o));
	
				let greatestFR = allottedFRs.reduce((m, e) => e.gt(m) ? e : m);
	
				expect(greatestFR).to.equal(allottedFRs[0]);
			});

			describe("Should treat partial transaction properly", () => {
				it("Should revert if not approved or owner", async () => {
					let unauthorizedCaller = nFR.connect(addrs[0]);

					await expect(unauthorizedCaller["transferFrom(address,address,uint256,uint256)"](owner.address, addrs[0].address, tokenId, transferAmount)).to.be.revertedWith("caller is not owner nor approved");
				});

				it("Should revert if the amount exceeds approved amount or asset amount", async () => {
					nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

					let authorizedCaller = nFR.connect(addrs[0]);

					await expect(authorizedCaller["transferFrom(address,address,uint256,uint256)"](owner.address, addrs[0].address, tokenId, tokenAmount)).to.be.revertedWith("caller is not owner nor approved");

					await expect(nFR["transferFrom(address,address,uint256,uint256)"](owner.address, addrs[0].address, tokenId, tokenAmount.add(1))).to.be.revertedWith("amount is too large");
				});

				it("Should partially transfer NFT", async () => {
					await nFR["transferFrom(address,address,uint256,uint256)"](owner.address, addrs[0].address, tokenId, transferAmount);
	
					let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address]];
					expect(await nFR.getFRInfo(tokenId + 1)).to.deep.equal(expectedArray);
				});
			});
		});

		describe("Approvals", () => {
			it("Should return approved amount", async () => {
				expect(await nFR.getApprovedAmount(tokenId)).to.equal(ethers.constants.AddressZero);
			});

			describe("ERC721 Approvals", () => {
				it("Should approve for the max asset amount", async () => {
					await nFR['approve(address,uint256)'](addrs[0].address, tokenId);
					
					expect(await nFR.getApproved(tokenId)).to.equal(addrs[0].address);
					expect(await nFR.getApprovedAmount(tokenId)).to.equal(tokenAmount);
				});

				it("Should succeed once approved", async () => {
					await nFR['approve(address,uint256)'](addrs[0].address, tokenId);

					let signer = nFR.connect(addrs[0]);

					await signer['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId);

					expect(await nFR.ownerOf(tokenId)).to.equal(addrs[0].address);
				});

				it("Should remove approvals on transfer", async () => {
					await nFR['approve(address,uint256)'](addrs[0].address, tokenId);

					await nFR['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId);

					expect(await nFR.getApproved(tokenId)).to.equal(ethers.constants.AddressZero);
					expect(await nFR.getApprovedAmount(tokenId)).to.equal(ethers.utils.parseUnits("0"));
				});
			});

			describe("isApprovedOrOwner", () => {
				describe("Reverts", () => {
					it("Should revert if not approved", async () => {
						let signer = nFR.connect(addrs[0]);

						await expect(signer['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId)).to.be.revertedWithCustomError(nFR, "ERC721Base__NotOwnerOrApproved");

						await expect(signer['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, tokenAmount)).to.be.revertedWith("caller is not owner nor approved");
					});
	
					it("Should revert ERC721 _isApprovedOrOwner call if not approved for max asset amount", async () => {
						await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

						let signer = nFR.connect(addrs[0]);

						await expect(signer['safeTransferFrom(address,address,uint256)'](owner.address, addrs[0].address, tokenId)).to.be.revertedWithCustomError(nFR, "ERC721Base__NotOwnerOrApproved");
					});

					it("Should revert if not approved for specified amount", async () => {
						await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

						let signer = nFR.connect(addrs[0]);

						await expect(signer['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, transferAmount.add(1))).to.be.revertedWith("caller is not owner nor approved");
					});

					it("Should revert if tokenId doesn't exist", async () => {
						await expect(nFR['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId + 1, transferAmount)).to.be.revertedWithCustomError(nFR, "ERC721Base__NonExistentToken");
					});
				});

				it("Should succeed if approved with setApprovalForAll", async () => {
					await nFR.setApprovalForAll(addrs[0].address, true);

					let signer = nFR.connect(addrs[0]);

					await signer['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, tokenAmount);

					expect(await nFR.ownerOf(tokenId)).to.equal(addrs[0].address);
				});

				it("Should succeed if owner calls", async () => {
					await nFR['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, tokenAmount);

					expect(await nFR.ownerOf(tokenId)).to.equal(addrs[0].address);
				});

				it("Should succeed when called with proper approved amount", async () => {
					await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

					let signer = nFR.connect(addrs[0]);

					await signer['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, transferAmount);

					expect(await nFR.ownerOf(tokenId + 1)).to.equal(addrs[0].address);
				});
			});

			describe("Fractional Approvals", () => {
				describe("Reverts", () => {
					it("Should revert if trying to approve for more than what is owned", async () => {
						await expect(nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, tokenAmount.add(1))).to.be.revertedWith("Approval amount exceeds asset amount");
					});

					it ("Should revert if trying to approve when not owner or approved for all", async () => {
						let signer = nFR.connect(addrs[0]);

						await expect(signer['approve(address,uint256,uint256)'](addrs[0].address, tokenId, tokenAmount)).to.be.revertedWithCustomError(nFR, "ERC721Base__NotOwnerOrApproved");
					});
				});

				it("Should set proper approval amount", async () => {
					await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

					expect(await nFR.getApprovedAmount(tokenId)).to.equal(transferAmount);
				});

				it("Should succeed when called with proper approval amount and by owner or approved for all", async () => {
					await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

					expect(await nFR.getApproved(tokenId)).to.equal(addrs[0].address);
					expect(await nFR.getApprovedAmount(tokenId)).to.equal(transferAmount);

					await nFR.setApprovalForAll(addrs[0].address, true);

					let signer = nFR.connect(addrs[0]);

					await signer['approve(address,uint256,uint256)'](addrs[1].address, tokenId, transferAmount);

					expect(await nFR.getApproved(tokenId)).to.equal(addrs[1].address);
					expect(await nFR.getApprovedAmount(tokenId)).to.equal(transferAmount);
				});

				it("Should remove approvals on transfer", async () => {
					await nFR['approve(address,uint256)'](addrs[0].address, tokenId);

					await nFR['transferFrom(address,address,uint256,uint256)'](owner.address, addrs[0].address, tokenId, transferAmount);

					expect(await nFR.getApproved(tokenId)).to.equal(ethers.constants.AddressZero);
					expect(await nFR.getApprovedAmount(tokenId)).to.equal(ethers.utils.parseUnits("0"));
				});	
			});

			it("Should remove approvals on burn", async () => {
				await nFR['approve(address,uint256,uint256)'](addrs[0].address, tokenId, transferAmount);

				await nFR.burnNFT(tokenId);

				expect(await nFR.getApprovedAmount(tokenId)).to.equal(ethers.utils.parseUnits("0"));
			});	
		});

		describe("Partial Buys", () => {
			describe("Reverts", () => {
				it("Should revert if amount supplied is too large", async () => {
					let buyer = nFR.connect(addrs[0]);

					await nFR.list(tokenId, transferAmount, baseSale);

					await expect(buyer.buy(tokenId, transferAmount.add(1), { value: baseSale })).to.be.revertedWith("Buy amount exceeds list amount");
				});

				it("Should revert if msg.value is not proportional to amount", async () => {
					let buyer = nFR.connect(addrs[0]);

					await nFR.list(tokenId, transferAmount, baseSale);

					await expect(buyer.buy(tokenId, transferAmount.div(2), { value: baseSale })).to.be.revertedWith("salePrice and msg.value mismatch");
					await expect(buyer.buy(tokenId, transferAmount.div(2), { value: baseSale.div(3) })).to.be.revertedWith("salePrice and msg.value mismatch");
				});
			});

			it("Should successfully fulfill a partial buy", async () => {
				let buyer = nFR.connect(addrs[0]);

				let balanceBefore = await ethers.provider.getBalance(owner.address);

				await nFR.list(tokenId, transferAmount, baseSale);

				await buyer.buy(tokenId, transferAmount.div(2), { value: mul(baseSale, transferAmount.div(2)) });

				expect(await ethers.provider.getBalance(owner.address)).to.be.above(balanceBefore.add(ethers.utils.parseUnits("0.25")).sub(ethers.utils.parseUnits("0.001")));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0"), ethers.BigNumber.from("1"), [owner.address] ]);
				expect(await nFR.getFRInfo(tokenId + 1)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, baseSale, ethers.BigNumber.from("2"), [owner.address, addrs[0].address] ]);

				expect(await nFR.getAssetInfo(tokenId)).to.equal(tokenAmount.sub(tokenAmount.div(4)));
				expect(await nFR.getAssetInfo(tokenId + 1)).to.equal(transferAmount.div(2));

				expect(await nFR.getListInfo(tokenId)).to.deep.equal([ baseSale, transferAmount.div(2), owner.address, true ]);
			});
		});

		describe("Whole Transactions", () => {
			it("Should treat a profitable transaction properly", async function() {
				let signer = nFR.connect(addrs[0]);
	
				let balanceBefore = await ethers.provider.getBalance(addrs[0].address);
	
				let expectedBalance = balanceBefore.sub(ethers.utils.parseUnits("1"));
	
				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
	
				await signer.buy(tokenId, tokenAmount, {
					value: ethers.utils.parseUnits("1")
				});
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.below(expectedBalance);
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address] ]);
	
				balanceBefore = await ethers.provider.getBalance(addrs[1].address);
	
				expectedBalance = balanceBefore.sub(ethers.utils.parseUnits("1"));
	
				let sellerExpectedBalance = (await ethers.provider.getBalance(addrs[0].address)).add(ethers.utils.parseUnits("0.5")).sub(ethers.utils.parseUnits("0.001"));
	
				await signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1.5"));
	
				let buyer = nFR.connect(addrs[1]);
				
				await buyer.buy(tokenId, tokenAmount, {
					value: ethers.utils.parseUnits("1.5")
				});
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.above(sellerExpectedBalance);
				expect(await ethers.provider.getBalance(addrs[1].address)).to.be.below(expectedBalance);
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0.08"));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0.08"));
				expect(await nFR.getAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1.5"), ethers.BigNumber.from("3"), [owner.address, addrs[0].address, addrs[1].address] ]);
			});
	
			it("Should treat an unprofitable transaction properly", async function() {
				let signer = await nFR.connect(addrs[0]);
	
				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
	
				await signer.buy(tokenId, tokenAmount, {
					value: ethers.utils.parseUnits("1")
				});
	
				let secondSigner = await nFR.connect(addrs[1]);
	
				let balanceBefore = await ethers.provider.getBalance(addrs[0].address);
	
				await signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("0.5"));
	
				await secondSigner.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("0.5") });
	
				expect(await ethers.provider.getBalance(addrs[0].address)).to.be.above(balanceBefore.add(ethers.utils.parseUnits("0.5")).sub(ethers.utils.parseUnits("0.001")));
				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0.5"), ethers.BigNumber.from("3"), [owner.address, addrs[0].address, addrs[1].address] ]);
			});

			it("Should reset list info after sale", async function() {
				let signer = await nFR.connect(addrs[0]);
	
				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
	
				await signer.buy(tokenId, tokenAmount, {
					value: ethers.utils.parseUnits("1")
				});
	
				expect(await nFR.getListInfo(tokenId)).to.deep.equal([ ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
			});

			it("Should run through 10 FR generations successfully", async function() {
				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));
	
				let s = nFR.connect(addrs[0]);
	
				await s.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1") });
	
				for (let transfers = 0; transfers < 9; transfers++) { // This results in 11 total owners, minter, transfer, 9 more transfers.
					let signer = nFR.connect(addrs[transfers]);
					let secondSigner = nFR.connect(addrs[transfers + 1]);
	
					let salePrice = (await nFR.getFRInfo(tokenId))[3].add(ethers.utils.parseUnits(saleIncrementor)); // Get lastSoldPrice and add incrementor
	
					await signer.list(tokenId, tokenAmount, salePrice);
	
					await secondSigner.buy(tokenId, tokenAmount, { value: salePrice });
				}
	
				let expectedArray: any = [numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("5.5"), ethers.BigNumber.from("11"), []]; // [3] = 5.5 because 1 [initial sale] +  9 * 0.5 [9 sales of 0.5 (11th holder didn't sell, so there were only 10 sales incl minter)] | [4] = 11 because minter + 10 owners
	
				for (let a = 0; a < 10; a++) {
					expectedArray[5].push(addrs[a].address);
				}
	
				expect(await nFR.getFRInfo(tokenId)).to.deep.equal(expectedArray);
	
				expect(await ethers.provider.getBalance(nFR.address)).to.be.above(ethers.utils.parseUnits("0.719")); // (9 * 0.5 * 0.16) = 0.72 - Taking fixed-point dust into account
	
				let totalOwners = [owner.address, ...expectedArray[5]];
	
				let allottedFRs = [];
	
				for (let o of totalOwners) allottedFRs.push(await nFR.getAllottedFR(o));
	
				let greatestFR = allottedFRs.reduce((m, e) => e.gt(m) ? e : m);
	
				expect(greatestFR).to.equal(allottedFRs[0]);
			});
		});

		it("Should emit Transferred", async () => {
			let signer = nFR.connect(addrs[0]);

			await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));

			await signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1") });

			await signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1.5"));

			signer = nFR.connect(addrs[1]);

			await expect(signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1.5") })).to.emit(nFR, "Transferred")
			.withArgs(tokenId, tokenAmount, ethers.utils.parseUnits("0.5"), 0);
		});

		it("Should emit FRDistributed", async function() {
			let signer = nFR.connect(addrs[0]);

			await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));

			await signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1") });

			await signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1.5"));

			signer = nFR.connect(addrs[1]);

			await expect(signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1.5") })).to.emit(nFR, "FRDistributed")
			.withArgs(tokenId, ethers.utils.parseUnits("0.08"));
		});

		describe("Claiming", function() {
			it("Should release FR if allotted, and update state accordingly", async function() {
				let signer = nFR.connect(addrs[0]);

				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));

				await signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1") });

				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0"));

				signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1.5"));

				signer = nFR.connect(addrs[1]);

				signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1.5") });

				expect(await nFR.getAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));

				let expectedBalance = (await ethers.provider.getBalance(owner.address)).add(ethers.utils.parseUnits("0.08"));

				await nFR.releaseFR(owner.address);

				expect(await nFR.getAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await ethers.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await ethers.provider.getBalance(owner.address)).to.be.above(expectedBalance.sub(ethers.utils.parseUnits("0.001"))); // gas accounting
			});

			it("Should revert if no FR allotted", async function() {
				await expect(nFR.releaseFR(owner.address)).to.be.revertedWith("No FR Payment due");
			});

			it("Should emit FRClaimed", async function() {
				let signer = nFR.connect(addrs[0]);

				await nFR.list(tokenId, tokenAmount, ethers.utils.parseUnits("1"));

				await signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1") });

				await signer.list(tokenId, tokenAmount, ethers.utils.parseUnits("1.5"));

				signer = await nFR.connect(addrs[1]);

				await signer.buy(tokenId, tokenAmount, { value: ethers.utils.parseUnits("1.5") });

				await expect(nFR.releaseFR(owner.address)).to.emit(nFR, "FRClaimed").withArgs(owner.address, ethers.utils.parseUnits("0.08"));
			});
		});
	});


});