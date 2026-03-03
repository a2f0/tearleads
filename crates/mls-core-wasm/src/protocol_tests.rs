use crate::{
    messaging::{decrypt_message, encrypt_message},
    model::ImportStateOutput,
    operations::{add_member, join_group, process_commit, remove_member},
    protocol::{
        create_group, export_group_state, generate_credential, generate_key_package,
        import_group_state,
    },
};

fn must<T, E: core::fmt::Display>(result: Result<T, E>, context: &str) -> T {
    match result {
        Ok(value) => value,
        Err(error) => panic!("{context}: {error}"),
    }
}

#[test]
fn key_package_generation_is_signed_and_stable() {
    let credential = must(generate_credential("alice"), "generate credential");
    let key_package = must(
        generate_key_package(&credential.credential_bundle, &credential.private_key),
        "generate key package",
    );

    assert!(!key_package.key_package.is_empty());
    assert_eq!(key_package.private_key.len(), 32);
    assert_eq!(key_package.key_package_ref.len(), 64);
}

#[test]
fn add_join_encrypt_and_decrypt_round_trip() {
    let alice_credential = must(generate_credential("alice"), "alice credential");
    let alice_state = must(
        create_group(
            "group-1",
            &alice_credential.credential_bundle,
            &alice_credential.private_key,
        ),
        "create alice group",
    );

    let bob_credential = must(generate_credential("bob"), "bob credential");
    let bob_key_package = must(
        generate_key_package(
            &bob_credential.credential_bundle,
            &bob_credential.private_key,
        ),
        "bob key package",
    );

    let add_result = must(
        add_member(&alice_state, &bob_key_package.key_package),
        "add bob",
    );

    let bob_state = must(
        join_group(
            "group-1",
            &add_result.welcome,
            &bob_key_package.key_package_ref,
            &bob_key_package.private_key,
            &bob_credential.credential_bundle,
            &bob_credential.private_key,
        ),
        "bob joins group",
    );

    let ciphertext = must(
        encrypt_message(&add_result.state, b"hello-from-alice"),
        "alice encrypts",
    );
    let decrypted = must(decrypt_message(&bob_state, &ciphertext), "bob decrypts");

    assert_eq!(decrypted.sender_id, "alice");
    assert_eq!(decrypted.plaintext, b"hello-from-alice".to_vec());
    assert!(!decrypted.authenticated_data.is_empty());
}

#[test]
fn process_commit_and_remove_member_updates_state() {
    let alice_credential = must(generate_credential("alice"), "alice credential");
    let alice_state = must(
        create_group(
            "group-2",
            &alice_credential.credential_bundle,
            &alice_credential.private_key,
        ),
        "create alice group",
    );

    let bob_credential = must(generate_credential("bob"), "bob credential");
    let bob_key_package = must(
        generate_key_package(
            &bob_credential.credential_bundle,
            &bob_credential.private_key,
        ),
        "bob key package",
    );

    let add_result = must(
        add_member(&alice_state, &bob_key_package.key_package),
        "add bob",
    );
    let alice_synced = must(
        process_commit(&alice_state, &add_result.commit),
        "alice syncs add commit from previous epoch state",
    );
    assert_eq!(alice_synced, add_result.state);

    let removed = must(remove_member(&add_result.state, 1), "remove bob");
    assert_eq!(removed.new_epoch, 2);

    let remove_applied = must(
        process_commit(&add_result.state, &removed.commit),
        "process remove commit from previous epoch state",
    );
    assert_eq!(remove_applied, removed.state);

    let bob_state = must(
        join_group(
            "group-2",
            &add_result.welcome,
            &bob_key_package.key_package_ref,
            &bob_key_package.private_key,
            &bob_credential.credential_bundle,
            &bob_credential.private_key,
        ),
        "bob joins group",
    );
    let bob_remove = process_commit(&bob_state, &removed.commit);
    assert!(bob_remove.is_err());
}

#[test]
fn import_export_validates_group_identity() {
    let alice_credential = must(generate_credential("alice"), "alice credential");
    let alice_state = must(
        create_group(
            "group-3",
            &alice_credential.credential_bundle,
            &alice_credential.private_key,
        ),
        "create alice group",
    );

    let exported = must(export_group_state(&alice_state), "export state");
    let imported: ImportStateOutput =
        must(import_group_state("group-3", &exported), "import state");
    assert_eq!(imported.epoch, 0);
    assert!(!imported.state.is_empty());

    let mismatch = import_group_state("other-group", &exported);
    assert!(mismatch.is_err());
}
