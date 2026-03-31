# Access Fingerprint

An access fingerprint is a composite access view for a container.

It starts from the container's ACL entries, follows those ACL subject links to
users, groups, and organizations, and then expands group and organization
membership into the effective set of users who currently reach the container.

To support nested groups, the source graph includes both `group -> user`
membership and `group -> group` membership, and group expansion is transitive.

This is meant as an authorization-side composite, not a single user's crypto
key fingerprint.

```mermaid
flowchart LR
  C[Container]
  AF[Access Fingerprint<br/>composite access view]

  subgraph SG["ACL Source Graph"]
    A1[ACL<br/>subject = user]
    A2[ACL<br/>subject = group]
    A3[ACL<br/>subject = organization]

    U[User]
    G[Group]
    O[Organization]

    GM[Group -> user membership]
    GGM[Group -> group membership]
    OM[Organization membership]
  end

  subgraph RS["Resolved Subjects"]
    RU[Effective users]
    RG[Reachable groups<br/>direct + nested]
    RO[Referenced organizations]
  end

  C -->|has ACLs| A1
  C -->|has ACLs| A2
  C -->|has ACLs| A3

  A1 -->|direct subject| U
  A2 -->|direct subject| G
  A3 -->|direct subject| O

  U -->|included directly| RU
  O -->|included directly| RO

  G -->|seed group| RG
  RG -->|follow nested edges| GGM
  GGM -->|discover child groups| RG

  RG -->|expand to user members| GM
  O -->|expands through| OM

  GM -->|member users| RU
  OM -->|member users| RU

  RU --> AF
  RG --> AF
  RO --> AF

  AF -->|attached to or cached for| C
```

In that model, the access fingerprint answers:

- which users have effective access right now
- which groups and organizations contributed to that access
- which nested groups were reached transitively from an ACL-linked group
- which ACL edges explain why the container is reachable
