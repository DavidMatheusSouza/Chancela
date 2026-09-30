"""
Runs against the public deployment and Monad testnet -- no account, no key:

    pip install eth-account
    python demo.py

TA-LIVE is a public trading agent whose owner allows PLACE_ORDER up to $500 per
order and nothing that moves funds out. Replace `place_order` with your
exchange call and "TA-LIVE" with your own agent id.
"""

import os

from chancela import Chancela, ChancelaError

chancela = Chancela(
    base_url=os.environ.get("CHANCELA_API_URL", "https://chancela.xyz"),
    # Whose signature counts is read from Monad, not from the server being checked.
    token_ids={"TA-LIVE": 4},
)

AGENT = "TA-LIVE"


def place_order(order: dict) -> str:
    # Your exchange / router call goes here. It only ever runs inside guard().
    return f"sent {order['side']} {order['market']} ${order['amount'] / 100:,.2f}"


def attempt(label: str, order: dict) -> None:
    try:
        result = chancela.guard(AGENT, "PLACE_ORDER", order, lambda decision: place_order(order))
        print(f"{label}: {result}")
    except ChancelaError as err:
        print(f"{label}: NOT SENT -- {err.code}: {err}")


# 1. Inside the policy: the order goes out.
attempt("$200 order   ", {"amount": 20_000, "market": "MON/USDC", "side": "BUY", "orderType": "MARKET"})

# 2. Over the per-order limit -- say, the model was talked into it: never sent.
attempt("$2,000 order ", {"amount": 200_000, "market": "MON/USDC", "side": "BUY", "orderType": "MARKET"})

# 3. The permission was for $200, but something between the check and the send
#    changed the order. The capsule commits to the order's hash, so it fails.
asked = {"amount": 20_000, "market": "MON/USDC", "side": "SELL", "orderType": "MARKET"}
decision = chancela.authorize(AGENT, "PLACE_ORDER", asked)
swapped = dict(asked, amount=2_000_000)
print(f"swapped order: {decision['decision']} for $200, then {chancela.verify(decision, AGENT, 'PLACE_ORDER', swapped).code} for $20,000")

# Every decision above, the refusals included, is anchored on Monad:
print(f"proof of the last one: {chancela.base_url}/proof/{decision['auditId']}")
