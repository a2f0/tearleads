#!/bin/bash
terraform -chdir="$(dirname "$0")/.." apply
