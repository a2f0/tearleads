#!/bin/bash
set -eu

echo "ERROR: destroy is disabled for the bootstrap stack"
echo ""
echo "This stack contains critical resources that protect all other Terraform state:"
echo "  - S3 bucket: tearleads-terraform-state"
echo "  - DynamoDB table: tearleads-terraform-locks"
echo ""
echo "Destroying these resources would make ALL other stacks unrecoverable."
echo ""
echo "If you truly need to destroy this stack, you must:"
echo "  1. Migrate all other stacks to a different backend first"
echo "  2. Manually remove prevent_destroy lifecycle rules"
echo "  3. Disable DynamoDB deletion protection"
echo "  4. Run terraform destroy manually"
echo ""
exit 1
