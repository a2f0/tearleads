//! Build script that generates Rust contracts from v2 proto definitions.

use std::{env, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let proto_root = manifest_dir.join("../../proto");
    let protos = [
        proto_root.join("tearleads/v2/admin.proto"),
        proto_root.join("tearleads/v2/mls.proto"),
    ];

    let protoc_path = protoc_bin_vendored::protoc_bin_path()?;
    let mut prost_config = tonic_build::Config::new();
    prost_config.protoc_executable(protoc_path);

    tonic_build::configure()
        .build_transport(false)
        .compile_protos_with_config(prost_config, &protos, &[proto_root])?;

    Ok(())
}
