import type { IsoCatalogEntry } from './types';

export const ISO_CATALOG: IsoCatalogEntry[] = [
  {
    id: 'openbsd-7.6-amd64',
    name: 'OpenBSD 7.6',
    description: 'OpenBSD 7.6 install CD for amd64',
    downloadUrl: 'https://cdn.openbsd.org/pub/OpenBSD/7.6/amd64/install76.iso',
    sizeBytes: 637_534_208,
    bootType: 'cdrom',
    memoryMb: 256
  },
  {
    id: 'freedos-1.3',
    name: 'FreeDOS 1.3',
    description: 'FreeDOS 1.3 LiveCD - lightweight DOS-compatible OS',
    downloadUrl:
      'https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.3/official/FD13-LiveCD.zip',
    sizeBytes: 670_000_000,
    bootType: 'cdrom',
    memoryMb: 32
  },
  {
    id: 'alpine-3.20-x86',
    name: 'Alpine Linux 3.20',
    description: 'Alpine Linux 3.20 Virtual x86 ISO',
    downloadUrl:
      'https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86/alpine-virt-3.20.3-x86.iso',
    sizeBytes: 63_963_136,
    bootType: 'cdrom',
    memoryMb: 128
  },
  {
    id: 'kolibrios-2024',
    name: 'KolibriOS',
    description: 'KolibriOS - tiny graphical OS written in assembly',
    downloadUrl: 'https://builds.kolibrios.org/eng/latest-iso.7z',
    sizeBytes: 50_000_000,
    bootType: 'cdrom',
    memoryMb: 64
  }
];

export function getIsoCatalogEntry(id: string): IsoCatalogEntry | undefined {
  return ISO_CATALOG.find((entry) => entry.id === id);
}
