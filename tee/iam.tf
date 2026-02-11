data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "enclave_host" {
  name               = "${local.name_prefix}-enclave-host-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.enclave_host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "kms_access" {
  statement {
    sid    = "AllowUseOfTEEKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.tee.arn]
  }
}

resource "aws_iam_role_policy" "kms_access" {
  name   = "${local.name_prefix}-kms-access"
  role   = aws_iam_role.enclave_host.id
  policy = data.aws_iam_policy_document.kms_access.json
}

resource "aws_iam_instance_profile" "enclave_host" {
  name = "${local.name_prefix}-enclave-host-profile"
  role = aws_iam_role.enclave_host.name
  tags = local.tags
}
