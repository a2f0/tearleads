resource "aws_vpc" "k8s" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "tearleads-prod-k8s"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
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
  allowed_k8s_api_ipv4 = [
    for cidr in var.allowed_k8s_api_ips : cidr
    if length(regexall(":", cidr)) == 0
  ]
  allowed_k8s_api_ipv6 = [
    for cidr in var.allowed_k8s_api_ips : cidr
    if length(regexall(":", cidr)) > 0
  ]
}

resource "aws_internet_gateway" "k8s" {
  vpc_id = aws_vpc.k8s.id

  tags = {
    Name        = "tearleads-prod-k8s"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.k8s.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "tearleads-prod-k8s-public-a"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

resource "aws_subnet" "rds_a" {
  vpc_id            = aws_vpc.k8s.id
  cidr_block        = var.rds_subnet_a_cidr
  availability_zone = "${var.aws_region}a"

  tags = {
    Name        = "tearleads-prod-k8s-rds-a"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

resource "aws_subnet" "rds_b" {
  vpc_id            = aws_vpc.k8s.id
  cidr_block        = var.rds_subnet_b_cidr
  availability_zone = "${var.aws_region}b"

  tags = {
    Name        = "tearleads-prod-k8s-rds-b"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.k8s.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.k8s.id
  }

  tags = {
    Name        = "tearleads-prod-k8s-public"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "k8s_server" {
  name        = "tearleads-prod-k8s-server"
  description = "Security group for prod k8s EC2 server"
  vpc_id      = aws_vpc.k8s.id

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
    description = "Kubernetes API"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = local.allowed_k8s_api_ipv4
  }

  ingress {
    description      = "Kubernetes API (IPv6)"
    from_port        = 6443
    to_port          = 6443
    protocol         = "tcp"
    ipv6_cidr_blocks = local.allowed_k8s_api_ipv6
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
    Name        = "tearleads-prod-k8s-server"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
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

data "aws_key_pair" "dps_blackbox" {
  key_name = "dps-blackbox"
}

resource "aws_instance" "server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.k8s_server.id]
  key_name               = data.aws_key_pair.dps_blackbox.key_name

  user_data = <<-EOF
    #cloud-config
    ssh_deletekeys: false
    ssh_genkeytypes: ['rsa', 'ecdsa']

    write_files:
      - path: /etc/ssh/ssh_host_ed25519_key
        owner: root:root
        permissions: '0600'
        encoding: b64
        content: ${base64encode("${chomp(var.ssh_host_private_key)}\n")}
      - path: /etc/ssh/ssh_host_ed25519_key.pub
        owner: root:root
        permissions: '0644'
        encoding: b64
        content: ${base64encode("${chomp(var.ssh_host_public_key)}\n")}

    runcmd:
      - systemctl restart ssh
      - if ! id -u ${var.server_username} >/dev/null 2>&1; then useradd -m -s /bin/bash -G sudo ${var.server_username}; fi
      - cp -r /home/ubuntu/.ssh /home/${var.server_username}/.ssh || true
      - chown -R ${var.server_username}:${var.server_username} /home/${var.server_username}/.ssh || true
      - echo '${var.server_username} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-${var.server_username}
      - chmod 440 /etc/sudoers.d/90-${var.server_username}
      - curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
      - chmod +x /tmp/install-k3s.sh
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.domain} --tls-san k8s-api.${var.domain}" /tmp/install-k3s.sh
      - rm /tmp/install-k3s.sh
      - mkdir -p /home/${var.server_username}/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/${var.server_username}/.kube/config
      - chown -R ${var.server_username}:${var.server_username} /home/${var.server_username}/.kube
  EOF

  tags = {
    Name        = "k8s-prod-${var.domain}"
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "k8s"
  }
}

# Cloudflare zone lookup for DNS records
data "cloudflare_zone" "production" {
  account_id = var.cloudflare_account_id
  name       = var.domain
}

# Cloudflare Tunnel - routes traffic through Cloudflare without exposing public IP
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.production.id
  lookup_zone_by_name = false
  tunnel_name         = "k8s-prod"

  ingress_rules = [
    {
      hostname = var.domain
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    },
    {
      hostname = "app.${var.domain}"
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    },
    {
      hostname = "api.${var.domain}"
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    }
  ]
}

# Direct DNS records for SSH access (not proxied through tunnel)
resource "cloudflare_record" "k8s_ssh" {
  zone_id = data.cloudflare_zone.production.id
  name    = "k8s-ssh.${var.domain}"
  type    = "A"
  content = aws_instance.server.public_ip
  proxied = false
  ttl     = 1
}

# Direct DNS records for Kubernetes API access (not proxied through tunnel)
resource "cloudflare_record" "k8s_api" {
  zone_id = data.cloudflare_zone.production.id
  name    = "k8s-api.${var.domain}"
  type    = "A"
  content = aws_instance.server.public_ip
  proxied = false
  ttl     = 1
}
