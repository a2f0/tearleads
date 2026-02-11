output "vpc_id" {
  description = "VPC ID for the TEE environment."
  value       = aws_vpc.tee.id
}

output "public_subnet_id" {
  description = "Public subnet where the enclave host runs."
  value       = aws_subnet.public.id
}

output "enclave_host_instance_id" {
  description = "Parent EC2 instance ID with Nitro Enclaves enabled."
  value       = aws_instance.enclave_host.id
}

output "enclave_host_public_ip" {
  description = "Public IP of the enclave host."
  value       = aws_instance.enclave_host.public_ip
}

output "kms_key_arn" {
  description = "KMS key ARN for enclave workflows."
  value       = aws_kms_key.tee.arn
}
