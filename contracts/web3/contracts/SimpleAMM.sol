// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SimpleAMM — minimal constant-product (x·y=k) DEX, tokenA <-> tokenB
//
//  A real, on-chain swap venue for Mantle Sepolia: VaultManager swaps the
//  vault's aUSD into the volatile token here when copying a leader BUY, and back
//  to aUSD on close — real tokens move, real swap volume, real (swap-derived)
//  P&L. Stands in for Agni/Merchant Moe so we don't need real mainnet liquidity;
//  the swap interface mirrors a standard router, so it can be pointed at a real
//  DEX later by changing one address.
//
//  0.30% fee, same constant-product math as Uniswap v2.
// ─────────────────────────────────────────────────────────────────────────────
contract SimpleAMM {
    address public immutable tokenA; // aUSD (6 decimals)
    address public immutable tokenB; // mWMNT (18 decimals)

    uint256 public reserveA;
    uint256 public reserveB;

    uint16 public constant FEE_BPS = 30; // 0.30%

    event LiquidityAdded(uint256 amountA, uint256 amountB);
    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);

    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "AMM: zero token");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /// @notice Seed / top-up pool liquidity. Caller must pre-approve both tokens.
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(amountA > 0 && amountB > 0, "AMM: zero liquidity");
        require(IERC20Min(tokenA).transferFrom(msg.sender, address(this), amountA), "AMM: tokenA in failed");
        require(IERC20Min(tokenB).transferFrom(msg.sender, address(this), amountB), "AMM: tokenB in failed");
        reserveA += amountA;
        reserveB += amountB;
        emit LiquidityAdded(amountA, amountB);
    }

    /// @notice Constant-product quote with 0.30% fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256)
    {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "AMM: insufficient");
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
    }

    /// @notice Quote how much `tokenOut` you'd get for `amountIn` of `tokenIn`.
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool aToB = tokenIn == tokenA;
        require(aToB || tokenIn == tokenB, "AMM: bad token");
        (uint256 rIn, uint256 rOut) = aToB ? (reserveA, reserveB) : (reserveB, reserveA);
        return getAmountOut(amountIn, rIn, rOut);
    }

    // ── UniswapV2 / FusionX router-compatible interface ───────────────────────
    // VaultManager talks to the DEX via this standard interface, so the `dex`
    // address can be swapped for a real FusionX V2 router on mainnet with no code
    // change. Only 2-token paths are supported (aUSD <-> tokenB).

    /// @notice V2-style quote — amounts[0]=amountIn, amounts[1]=amountOut.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        require(path.length == 2, "AMM: 2-token path only");
        require(path[0] == tokenA || path[0] == tokenB, "AMM: bad token");
        (uint256 rIn, uint256 rOut) = path[0] == tokenA ? (reserveA, reserveB) : (reserveB, reserveA);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = getAmountOut(amountIn, rIn, rOut);
    }

    /// @notice V2-style swap — caller pre-approves `amountIn` of path[0].
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "AMM: 2-token path only");
        uint256 out = _swap(path[0], amountIn, amountOutMin, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }

    /// @notice Swap exact `amountIn` of `tokenIn` for `tokenOut`, sent to `to`.
    ///         Caller must pre-approve `amountIn` of `tokenIn`. Reverts if the
    ///         output is below `minOut` (slippage protection).
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external returns (uint256 amountOut)
    {
        return _swap(tokenIn, amountIn, minOut, to);
    }

    function _swap(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        internal returns (uint256 amountOut)
    {
        bool aToB = tokenIn == tokenA;
        require(aToB || tokenIn == tokenB, "AMM: bad token");
        require(amountIn > 0, "AMM: zero in");

        (uint256 rIn, uint256 rOut) = aToB ? (reserveA, reserveB) : (reserveB, reserveA);
        amountOut = getAmountOut(amountIn, rIn, rOut);
        require(amountOut >= minOut, "AMM: slippage");

        address tokenOut = aToB ? tokenB : tokenA;
        require(IERC20Min(tokenIn).transferFrom(msg.sender, address(this), amountIn), "AMM: in failed");
        require(IERC20Min(tokenOut).transfer(to, amountOut), "AMM: out failed");

        if (aToB) { reserveA += amountIn; reserveB -= amountOut; }
        else      { reserveB += amountIn; reserveA -= amountOut; }

        emit Swapped(tokenIn, amountIn, amountOut, to);
    }
}
