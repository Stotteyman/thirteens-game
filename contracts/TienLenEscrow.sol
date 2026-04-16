// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TienLenEscrow {
    IERC20 public immutable stable;
    address public immutable operator;

    mapping(address => uint256) public balances;
    uint256 public totalHeld;

    event Deposited(address indexed player, uint256 amount);
    event CashoutRequested(address indexed player, uint256 amount);
    event InternalSettled(bytes32 indexed handId, address indexed winner, uint256 payout, uint256 pot);
    event Withdrawn(address indexed player, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "ONLY_OPERATOR");
        _;
    }

    constructor(address stableToken, address gameOperator) {
        require(stableToken != address(0), "BAD_TOKEN");
        require(gameOperator != address(0), "BAD_OPERATOR");
        stable = IERC20(stableToken);
        operator = gameOperator;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(stable.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAIL");

        balances[msg.sender] += amount;
        totalHeld += amount;

        emit Deposited(msg.sender, amount);
    }

    // Applies an off-chain computed ledger settlement after a completed hand.
    // This keeps in-game transfers instant/free and only touches chain on deposit/withdraw.
    function settleHand(
        bytes32 handId,
        address[] calldata players,
        uint256[] calldata debits,
        uint256[] calldata credits,
        address winner,
        uint256 winnerPayout,
        uint256 pot
    ) external onlyOperator {
        require(players.length == debits.length && players.length == credits.length, "BAD_ARRAYS");
        require(players.length > 1, "MIN_PLAYERS");

        uint256 totalDebits = 0;
        uint256 totalCredits = 0;

        for (uint256 i = 0; i < players.length; i++) {
            address p = players[i];
            require(p != address(0), "BAD_PLAYER");

            uint256 debit = debits[i];
            uint256 credit = credits[i];

            if (debit > 0) {
                require(balances[p] >= debit, "INSUFFICIENT_LEDGER");
                balances[p] -= debit;
                totalDebits += debit;
            }

            if (credit > 0) {
                balances[p] += credit;
                totalCredits += credit;
            }
        }

        require(totalDebits == pot, "BAD_POT");
        require(totalCredits == pot, "BAD_CREDITS");

        emit InternalSettled(handId, winner, winnerPayout, pot);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(balances[msg.sender] >= amount, "INSUFFICIENT_BALANCE");

        balances[msg.sender] -= amount;
        totalHeld -= amount;

        require(stable.transfer(msg.sender, amount), "TRANSFER_FAIL");
        emit Withdrawn(msg.sender, amount);
    }

    // Optional path for future relayer UX; currently emits intent for off-chain job queue.
    function requestCashout(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(balances[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        emit CashoutRequested(msg.sender, amount);
    }
}
