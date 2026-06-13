import { ethers } from "hardhat";

async function main() {
  console.log("Starting deployment of Greeting contract...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const initialGreeting = "Hello Mantle Sepolia Testnet!";
  const Greeting = await ethers.getContractFactory("Greeting");
  const contract = await Greeting.deploy(initialGreeting);

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Greeting contract deployed to:", address);
  console.log("Initial greeting set to:", initialGreeting);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
