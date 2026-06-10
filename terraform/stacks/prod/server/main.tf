resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "tearleads-prod-server"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

locals {
  allowed_ssh_ipv4 = [
    for cidr in var.allowed_ssh_ips : cidr
    if length(regexall(":", cidr)) == 0
  ]
  allowed_ssh_ipv6 = [
    for cidr in var.allowed_ssh_ips : cidr
    if length(regexall(":", cidr)) > 0
  ]
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "tearleads-prod-server"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "tearleads-prod-server-public-a"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "tearleads-prod-server-public"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "server" {
  name        = "tearleads-prod-server"
  description = "Security group for prod server"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = local.allowed_ssh_ipv4
  }

  ingress {
    description      = "SSH (IPv6)"
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    ipv6_cidr_blocks = local.allowed_ssh_ipv6
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description      = "HTTP (IPv6)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description      = "HTTPS (IPv6)"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description = "ICMP"
    from_port   = -1
    to_port     = -1
    protocol    = "icmp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "tearleads-prod-server"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_key_pair" "main" {
  key_name = var.ssh_key_name
}

resource "aws_instance" "server" {
  ami                    = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.server.id]
  key_name               = data.aws_key_pair.main.key_name
  source_dest_check      = false

  user_data = var.server_user_data

  tags = {
    Name        = "prod-${var.domain}"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "server"
  }
}

data "cloudflare_zone" "production" {
  filter = {
    account = {
      id = var.cloudflare_account_id
    }
    name = var.domain
  }
}

module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.production.id
  lookup_zone_by_name = false
  tunnel_name         = "prod"

  ingress_rules = [
    {
      hostname = var.domain
      service  = "http://localhost:80"
    },
    {
      hostname = "app.${var.domain}"
      service  = "http://localhost:80"
    },
    {
      hostname = "api.${var.domain}"
      service  = "http://localhost:80"
    }
  ]
}

resource "cloudflare_dns_record" "ssh" {
  zone_id = data.cloudflare_zone.production.id
  name    = "ssh.${var.domain}"
  type    = "A"
  content = aws_instance.server.public_ip
  proxied = false
  ttl     = 1
}
