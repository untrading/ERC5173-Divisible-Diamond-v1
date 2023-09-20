import { deployments, getNamedAccounts } from "hardhat";

/**
 * Deploys a new nFRFacet, supposed to be used before diamond_cut_nFRFacet.ts
 */
const main = async () => {  
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();
    
    await deploy("nFRFacet", {
        from: deployer,
    });
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});