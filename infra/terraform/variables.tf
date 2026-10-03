variable "project_id" { type = string }
variable "region" { type = string
 default = "asia-northeast1" }
variable "zone" { type = string
 default = "asia-northeast1-a" }
variable "environment" { type = string
 default = "staging" }
variable "org_id" { type = string }
variable "github_repository" { type = string }
variable "images" {
  type = object({ ops = string, public_site = string, worker = string, browser = string })
  validation {
    condition = alltrue([for image in values(var.images) : can(regex("@sha256:[a-f0-9]{64}$", image))])
    error_message = "Every deployed image must use a verified digest, not a mutable tag."
  }
}
variable "browser_boot_image" {
  type = string
  description = "An explicitly pinned COS image with Docker; verify its AMD64 platform before planning."
  validation { condition = !strcontains(var.browser_boot_image, "/family/")
 error_message = "Pin the operating-system image; image families are mutable." }
}
variable "database_tier" { type = string
 default = "db-custom-2-4096" }
variable "browser_machine_type" { type = string
 default = "e2-medium" }
variable "allow_public_site" { type = bool
 default = false }
