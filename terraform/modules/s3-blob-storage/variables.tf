variable "bucket" {
  description = "Bucket owned by the environment's storage stack"
  type = object({
    id     = string
    arn    = string
    region = string
  })
}

variable "iam_user_name" {
  description = "Dedicated API IAM user for this bucket"
  type        = string
}
