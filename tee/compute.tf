data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64"
}

resource "aws_instance" "enclave_host" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.enclave_host.id]
  iam_instance_profile   = aws_iam_instance_profile.enclave_host.name

  enclave_options {
    enabled = true
  }

  metadata_options {
    http_tokens = "required"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euxo pipefail
    dnf update -y
    dnf install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
    usermod -aG ne ec2-user
    systemctl enable --now nitro-enclaves-allocator.service
  EOF

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-enclave-host"
  })
}
