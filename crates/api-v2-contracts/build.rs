//! Build script that generates Rust contracts from v2 proto definitions.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn collect_proto_files(proto_directory: &Path) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let mut protos = Vec::new();

    for entry in fs::read_dir(proto_directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("proto") {
            protos.push(path);
        }
    }

    protos.sort();

    if protos.is_empty() {
        return Err(format!("no .proto files found in {}", proto_directory.display()).into());
    }

    Ok(protos)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let proto_root = manifest_dir.join("../../proto");
    let proto_v2_directory = proto_root.join("tearleads/v2");
    let protos = collect_proto_files(&proto_v2_directory)?;

    let protoc_path = protoc_bin_vendored::protoc_bin_path()?;
    let mut prost_config = tonic_build::Config::new();
    prost_config.protoc_executable(protoc_path);

    tonic_build::configure()
        .build_transport(false)
        .compile_protos_with_config(prost_config, &protos, &[proto_root])?;

    Ok(())
}
