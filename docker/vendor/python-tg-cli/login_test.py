#!/usr/bin/env python3
import asyncio
from tg_cli.client import connect


async def main():
    async with connect() as client:
        me = await client.get_me()
        print(f"Logged in as: {me.first_name} {me.last_name} (@{me.username})")


if __name__ == "__main__":
    asyncio.run(main())
