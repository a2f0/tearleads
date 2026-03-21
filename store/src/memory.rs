use crate::{Store, Tuple};
use protocol::Namespace;
use std::collections::{HashMap, HashSet};
use std::io;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Key {
    namespace: Namespace,
    object: String,
    relation: String,
    subject: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ListKey {
    namespace: Namespace,
    object: String,
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

    fn list_key(&self) -> ListKey {
        ListKey {
            namespace: self.namespace.clone(),
            object: self.object.clone(),
        }
    }
}

pub struct MemoryStore {
    data: HashMap<Key, Tuple>,
    list_index: HashMap<ListKey, HashSet<Key>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        MemoryStore {
            data: HashMap::new(),
            list_index: HashMap::new(),
        }
    }
}

impl Store for MemoryStore {
    fn write(&mut self, tuple: Tuple) -> io::Result<()> {
        let key = Key::from_tuple(&tuple);
        self.list_index
            .entry(key.list_key())
            .or_default()
            .insert(key.clone());
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

    fn list(&self, namespace: &Namespace, object: &str) -> io::Result<Vec<&Tuple>> {
        let list_key = ListKey {
            namespace: namespace.clone(),
            object: object.to_string(),
        };
        Ok(match self.list_index.get(&list_key) {
            Some(keys) => keys.iter().filter_map(|k| self.data.get(k)).collect(),
            None => Vec::new(),
        })
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
        if self.data.remove(&key).is_some() {
            if let Some(keys) = self.list_index.get_mut(&key.list_key()) {
                keys.remove(&key);
                if keys.is_empty() {
                    self.list_index.remove(&key.list_key());
                }
            }
            Ok(true)
        } else {
            Ok(false)
        }
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
