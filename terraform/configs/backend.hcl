# Bootstrap this bucket for new Tearleads stacks. Retire older resources using
# their owning state; never abandon live resources by selecting an empty backend.
bucket         = "tearleads-terraform-state"
region         = "us-east-1"
encrypt        = true
use_lockfile   = true
