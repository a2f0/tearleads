fn main() {
    let server = server::Server::bind("127.0.0.1:7878").unwrap();
    println!("Listening on 127.0.0.1:7878");

    loop {
        match server.accept_one() {
            Ok(msg) => println!("Received: {msg}"),
            Err(e) => eprintln!("Error: {e}"),
        }
    }
}
