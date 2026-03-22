use crate::{Store, Tuple};
use protocol::Namespace;
use std::collections::HashMap;
use std::io;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Key {
    namespace: Namespace,
    object: String,
    relation: String,
    subject: String,
}

impl Key {
    fn from_tuple(t: &Tuple) -> Self {
        Key {
            namespace: t.namespace.clone(),
            object: t.object.clone(),
            relation: t.relation.clone(),
            subject: t.subject.clone(),
        }
    }
}

pub struct MemoryStore {
    data: HashMap<Key, Tuple>,
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryStore {
    pub fn new() -> Self {
        MemoryStore {
            data: HashMap::new(),
        }
    }
}

impl Store for MemoryStore {
    fn write(&mut self, tuple: Tuple) -> io::Result<()> {
        let key = Key::from_tuple(&tuple);
        self.data.insert(key, tuple);
        Ok(())
    }

    fn read(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<Option<&Tuple>> {
        let key = Key {
            namespace: namespace.clone(),
            object: object.to_string(),
            relation: relation.to_string(),
            subject: subject.to_string(),
        };
        Ok(self.data.get(&key))
    }

    fn delete(
        &mut self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<bool> {
        let key = Key {
            namespace: namespace.clone(),
            object: object.to_string(),
            relation: relation.to_string(),
            subject: subject.to_string(),
        };
        Ok(self.data.remove(&key).is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_tuple(ns: Namespace, obj: &str, rel: &str, sub: &str, data: &[u8]) -> Tuple {
        Tuple {
            namespace: ns,
            object: obj.to_string(),
            relation: rel.to_string(),
            subject: sub.to_string(),
            payload: data.to_vec(),
        }
    }

    #[test]
    fn test_write_and_read() {
        let mut store = MemoryStore::new();
        let tuple = make_tuple(Namespace::Node, "doc1", "owner", "alice", b"hello world");
        store.write(tuple).unwrap();

        let result = store
            .read(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().payload, b"hello world");
    }

    #[test]
    fn test_read_not_found() {
        let store = MemoryStore::new();
        let result = store
            .read(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_upsert() {
        let mut store = MemoryStore::new();
        store
            .write(make_tuple(Namespace::Node, "doc1", "owner", "alice", b"v1"))
            .unwrap();
        store
            .write(make_tuple(Namespace::Node, "doc1", "owner", "alice", b"v2"))
            .unwrap();

        let result = store
            .read(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap()
            .unwrap();
        assert_eq!(result.payload, b"v2");
    }

    #[test]
    fn test_delete() {
        let mut store = MemoryStore::new();
        store
            .write(make_tuple(
                Namespace::Node,
                "doc1",
                "owner",
                "alice",
                b"data",
            ))
            .unwrap();

        let deleted = store
            .delete(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap();
        assert!(deleted);
        assert!(store
            .read(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_not_found() {
        let mut store = MemoryStore::new();
        let deleted = store
            .delete(&Namespace::Node, "doc1", "owner", "alice")
            .unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_edge_tuples() {
        let mut store = MemoryStore::new();
        // Create two nodes
        store
            .write(make_tuple(
                Namespace::Node,
                "parent1",
                "data",
                "system",
                b"parent data",
            ))
            .unwrap();
        store
            .write(make_tuple(
                Namespace::Node,
                "child1",
                "data",
                "system",
                b"child data",
            ))
            .unwrap();

        // Create edges: child1 has two parents (DAG)
        store
            .write(make_tuple(
                Namespace::Edge,
                "parent1",
                "child",
                "child1",
                b"",
            ))
            .unwrap();
        store
            .write(make_tuple(
                Namespace::Edge,
                "parent2",
                "child",
                "child1",
                b"",
            ))
            .unwrap();

        // Verify edges by direct lookup
        let edge1 = store
            .read(&Namespace::Edge, "parent1", "child", "child1")
            .unwrap();
        assert!(edge1.is_some());

        let edge2 = store
            .read(&Namespace::Edge, "parent2", "child", "child1")
            .unwrap();
        assert!(edge2.is_some());
    }
}
