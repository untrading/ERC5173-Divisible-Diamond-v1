import { ethers, deployments, getNamedAccounts } from "hardhat";

import { Selectors, FacetCutAction } from '../test/libraries/diamond';

/**
 * Upgrades the nFRDiamond with a new nFRFacet
 */
const main = async () => {  
    const { execute, get } = deployments;

    const { deployer } = await getNamedAccounts();

    const nFRFacet = await ethers.getContractAt("nFRFacet", (await get('nFRFacet')).address);

    const cut = [{ target: nFRFacet.address, action: FacetCutAction.Replace, selectors: new Selectors(nFRFacet).remove(['supportsInterface(bytes4)']) }]; // When removing, be sure to set target to AddressZero

    await execute('nFRDiamond', {from: deployer}, 'diamondCut', cut, ethers.constants.AddressZero, "0x");
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});