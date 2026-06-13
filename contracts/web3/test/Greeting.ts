import { expect } from "chai";
import { ethers } from "hardhat";

describe("Greeting", function () {
  async function deployFixture() {
    const [owner, otherAccount] = await ethers.getSigners();
    const Greeting = await ethers.getContractFactory("Greeting");
    const greeting = await Greeting.deploy("Hello Mantle!");
    return { greeting, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right greeting", async function () {
      const { greeting } = await deployFixture();
      expect(await greeting.greeting()).to.equal("Hello Mantle!");
    });

    it("Should set the right owner", async function () {
      const { greeting, owner } = await deployFixture();
      expect(await greeting.owner()).to.equal(owner.address);
    });
  });

  describe("Set Greeting", function () {
    it("Should update the greeting correctly", async function () {
      const { greeting } = await deployFixture();
      await greeting.setGreeting("Hello World!");
      expect(await greeting.greeting()).to.equal("Hello World!");
    });

    it("Should emit GreetingChanged event", async function () {
      const { greeting, owner } = await deployFixture();
      await expect(greeting.setGreeting("Event test"))
        .to.emit(greeting, "GreetingChanged")
        .withArgs(owner.address, "Event test");
    });
  });
});
