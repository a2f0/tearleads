# Bootstrap this bucket before stack initialization. If a populated stack moves
# here from another backend, migrate its state before running a plan.
bucket         = "tearleads-terraform-state"
region         = "us-east-1"
encrypt        = true
use_lockfile   = true
