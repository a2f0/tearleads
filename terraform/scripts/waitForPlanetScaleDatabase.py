#!/usr/bin/env python3
"""Wait for the Terraform-created PlanetScale database before creating roles."""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def wait_for_database():
    query = json.load(sys.stdin)
    organization = urllib.parse.quote(query["organization"], safe="")
    database = urllib.parse.quote(query["database"], safe="")
    request = urllib.request.Request(
        f"https://api.planetscale.com/v1/organizations/{organization}/databases/{database}",
        headers={
            "Authorization": (
                os.environ["PLANETSCALE_SERVICE_TOKEN_ID"]
                + ":"
                + os.environ["PLANETSCALE_SERVICE_TOKEN"]
            )
        },
    )
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise SystemExit(f"PlanetScale readiness request failed: HTTP {error.code}") from None
        if result.get("kind") != "postgresql":
            raise SystemExit("PlanetScale database has the wrong engine")
        if result.get("ready") and result.get("state") == "ready":
            print(json.dumps({"ready": "true"}))
            return
        time.sleep(5)
    raise SystemExit("PlanetScale database did not become ready within 10 minutes")


if __name__ == "__main__":
    wait_for_database()
