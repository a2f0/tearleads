use crate::{Store, Tuple};
use protocol::Namespace;
use std::io;

pub struct MemoryStore {
    tuples: Vec<Tuple>,
}

impl MemoryStore {
    pub fn new() -> Self {
        MemoryStore { tuples: Vec::new() }
    }
}

impl Store for MemoryStore {
    fn write(&mut self, tuple: Tuple) -> io::Result<()> {
        // Upsert: replace if same key exists
        if let Some(existing) = self.tuples.iter_mut().find(|t| {
            t.namespace == tuple.namespace
                && t.object == tuple.object
                && t.relation == tuple.relation
                && t.subject == tuple.subject
        }) {
            *existing = tuple;
        } else {
            self.tuples.push(tuple);
        }
        Ok(())
    }

    fn read(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<Option<&Tuple>> {
        Ok(self.tuples.iter().find(|t| {
            t.namespace == *namespace
                && t.object == object
                && t.relation == relation
                && t.subject == subject
        }))
    }

    fn list(&self, namespace: &Namespace, object: &str) -> io::Result<Vec<&Tuple>> {
        Ok(self
            .tuples
            .iter()
            .filter(|t| t.namespace == *namespace && t.object == object)
            .collect())
    }

    fn delete(
        &mut self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<bool> {
        let len_before = self.tuples.len();
        self.tuples.retain(|t| {
            !(t.namespace == *namespace
                && t.object == object
                && t.relation == relation
                && t.subject == subject)
        });
        Ok(self.tuples.len() < len_before)
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

        // Should still be one tuple, not two
        assert_eq!(store.list(&Namespace::Node, "doc1").unwrap().len(), 1);
    }

    #[test]
    fn test_list() {
        let mut store = MemoryStore::new();
        store
            .write(make_tuple(Namespace::Node, "doc1", "owner", "alice", b""))
            .unwrap();
        store
            .write(make_tuple(Namespace::Node, "doc1", "viewer", "bob", b""))
            .unwrap();
        store
            .write(make_tuple(Namespace::Node, "doc2", "owner", "alice", b""))
            .unwrap();

        let results = store.list(&Namespace::Node, "doc1").unwrap();
        assert_eq!(results.len(), 2);
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

        // List edges from parent1
        let edges = store.list(&Namespace::Edge, "parent1").unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].subject, "child1");

        // List edges from parent2
        let edges = store.list(&Namespace::Edge, "parent2").unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].subject, "child1");
    }
}
