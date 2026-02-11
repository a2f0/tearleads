# TEE Terraform Scaffold

This folder contains a starter Terraform scaffold for an AWS Nitro Enclaves
parent instance and supporting infrastructure.

## Included

- VPC, public subnet, route table, internet gateway, and security group
- EC2 parent instance with `enclave_options.enabled = true`
- IAM role/profile for SSM and KMS access
- Dedicated KMS key and alias for enclave-related encryption workflows
- Helper scripts in `scripts/` for init/plan/apply/destroy/update

## Quick start

```bash
cd tee
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

## Notes

- Default region is `us-east-1`; override with `-var aws_region=<region>`.
- Restrict SSH access by setting `allowed_ssh_cidr` to a trusted CIDR.
- This is a scaffold and not production-hardened yet.
