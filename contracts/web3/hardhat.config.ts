import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      // OZ v5 ERC-721 uses the `mcopy` opcode → needs the Cancun EVM target.
      // Mantle Sepolia (OP-stack, post-Dencun) supports it.
      evmVersion: "cancun",
    },
  },
  networks: {
    mantleSepolia: {
      url: "https://rpc.sepolia.mantle.xyz",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 5003,
    },
  },
  paths: {
    artifacts: "../../frontend/contracts/artifacts",
  },
};

export default config;
