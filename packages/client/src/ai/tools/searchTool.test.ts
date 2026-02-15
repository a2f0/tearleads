/**
 * Tests for the search tool.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeSearchTool,
  formatSearchResultsForDisplay,
  searchToolDefinition
} from './searchTool';

const mockSearch = vi.fn();
const mockGetState = vi.fn();

// Mock the dependencies
vi.mock('@/db', () => ({
  getCurrentInstanceId: vi.fn(() => null)
}));

vi.mock('@/search', () => ({
  getSearchStoreForInstance: vi.fn(() => ({
    getState: mockGetState,
    search: mockSearch
  }))
}));

describe('searchToolDefinition', () => {
  it('should have the correct name', () => {
    expect(searchToolDefinition.function.name).toBe('search_user_data');
  });

  it('should have a description', () => {
    expect(searchToolDefinition.function.description).toBeTruthy();
    expect(searchToolDefinition.function.description.length).toBeGreaterThan(
      50
    );
  });

  it('should require query parameter', () => {
    expect(searchToolDefinition.function.parameters.required).toContain(
      'query'
    );
  });

  it('should have entityTypes as optional array', () => {
    const entityTypes =
      searchToolDefinition.function.parameters.properties['entityTypes'];
    expect(entityTypes?.type).toBe('array');
    expect(entityTypes?.items?.enum).toContain('app');
    expect(entityTypes?.items?.enum).toContain('contact');
    expect(entityTypes?.items?.enum).toContain('note');
    expect(entityTypes?.items?.enum).toContain('email');
  });

  it('should have limit as optional number', () => {
    const limit = searchToolDefinition.function.parameters.properties['limit'];
    expect(limit?.type).toBe('number');
  });
});

describe('executeSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ isInitialized: false });
  });

  it('should return empty results when no instance', async () => {
    const result = await executeSearchTool({ query: 'test' });

    expect(result.results).toHaveLength(0);
    expect(result.totalFound).toBe(0);
    expect(result.query).toBe('test');
  });

  it('should return empty results when not initialized', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: false });

    const result = await executeSearchTool({ query: 'test' });

    expect(result.results).toHaveLength(0);
    expect(result.totalFound).toBe(0);
    expect(result.query).toBe('test');
  });

  it('should search and return results when initialized', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({
      hits: [
        {
          id: 'doc-1',
          entityType: 'contact',
          score: 0.95,
          document: {
            id: 'doc-1',
            entityType: 'contact',
            title: 'John Doe',
            content: 'Contact details for John Doe',
            createdAt: 1000,
            updatedAt: 1000
          }
        }
      ],
      count: 1
    });

    const result = await executeSearchTool({ query: 'john' });

    expect(mockSearch).toHaveBeenCalledWith('john', { limit: 5 });
    expect(result.results).toHaveLength(1);
    expect(result.totalFound).toBe(1);
    expect(result.results[0]?.id).toBe('doc-1');
    expect(result.results[0]?.type).toBe('contact');
    expect(result.results[0]?.title).toBe('John Doe');
    expect(result.results[0]?.preview).toBe('Contact details for John Doe');
  });

  it('should respect limit parameter', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({ hits: [], count: 0 });

    await executeSearchTool({ query: 'test', limit: 10 });

    expect(mockSearch).toHaveBeenCalledWith('test', { limit: 10 });
  });

  it('should clamp limit to max 20', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({ hits: [], count: 0 });

    await executeSearchTool({ query: 'test', limit: 100 });

    expect(mockSearch).toHaveBeenCalledWith('test', { limit: 20 });
  });

  it('should clamp limit to min 1', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({ hits: [], count: 0 });

    await executeSearchTool({ query: 'test', limit: 0 });

    expect(mockSearch).toHaveBeenCalledWith('test', { limit: 1 });
  });

  it('should pass entityTypes filter when provided', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({ hits: [], count: 0 });

    await executeSearchTool({
      query: 'test',
      entityTypes: ['contact', 'note']
    });

    expect(mockSearch).toHaveBeenCalledWith('test', {
      limit: 5,
      entityTypes: ['contact', 'note']
    });
  });

  it('should truncate long content to 150 chars with ellipsis', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    const longContent = 'A'.repeat(200);
    mockSearch.mockResolvedValue({
      hits: [
        {
          id: 'doc-1',
          entityType: 'note',
          score: 0.9,
          document: {
            id: 'doc-1',
            entityType: 'note',
            title: 'Long Note',
            content: longContent,
            createdAt: 1000,
            updatedAt: 1000
          }
        }
      ],
      count: 1
    });

    const result = await executeSearchTool({ query: 'test' });

    expect(result.results[0]?.preview).toBe(`${'A'.repeat(150)}...`);
  });

  it('should use metadata for preview if no content', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({
      hits: [
        {
          id: 'doc-1',
          entityType: 'contact',
          score: 0.9,
          document: {
            id: 'doc-1',
            entityType: 'contact',
            title: 'Jane Doe',
            metadata: 'email: jane@example.com, phone: 555-1234',
            createdAt: 1000,
            updatedAt: 1000
          }
        }
      ],
      count: 1
    });

    const result = await executeSearchTool({ query: 'jane' });

    expect(result.results[0]?.preview).toBe(
      'email: jane@example.com, phone: 555-1234'
    );
  });

  it('should not add preview if no content or metadata', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({
      hits: [
        {
          id: 'doc-1',
          entityType: 'file',
          score: 0.8,
          document: {
            id: 'doc-1',
            entityType: 'file',
            title: 'document.pdf',
            createdAt: 1000,
            updatedAt: 1000
          }
        }
      ],
      count: 1
    });

    const result = await executeSearchTool({ query: 'document' });

    expect(result.results[0]?.preview).toBeUndefined();
  });

  it('should return correct totalFound when limited', async () => {
    const { getCurrentInstanceId } = await import('@/db');
    vi.mocked(getCurrentInstanceId).mockReturnValue('test-instance');
    mockGetState.mockReturnValue({ isInitialized: true });
    mockSearch.mockResolvedValue({
      hits: [
        {
          id: 'doc-1',
          entityType: 'contact',
          score: 0.9,
          document: {
            id: 'doc-1',
            entityType: 'contact',
            title: 'Contact 1',
            createdAt: 1000,
            updatedAt: 1000
          }
        }
      ],
      count: 100
    });

    const result = await executeSearchTool({ query: 'contact', limit: 1 });

    expect(result.results).toHaveLength(1);
    expect(result.totalFound).toBe(100);
  });
});

describe('formatSearchResultsForDisplay', () => {
  it('should format empty results', () => {
    const formatted = formatSearchResultsForDisplay({
      results: [],
      totalFound: 0,
      query: 'test query'
    });

    expect(formatted).toContain('No results found');
    expect(formatted).toContain('test query');
  });

  it('should format results with count', () => {
    const formatted = formatSearchResultsForDisplay({
      results: [
        { id: '1', type: 'contact', title: 'John Doe', score: 1 },
        {
          id: '2',
          type: 'note',
          title: 'Meeting Notes',
          preview: 'Preview text',
          score: 0.8
        }
      ],
      totalFound: 2,
      query: 'john'
    });

    expect(formatted).toContain('Found 2 result(s)');
    expect(formatted).toContain('John Doe');
    expect(formatted).toContain('Contact');
    expect(formatted).toContain('Meeting Notes');
    expect(formatted).toContain('Note');
    expect(formatted).toContain('Preview text');
  });

  it('should format entity types correctly', () => {
    const formatted = formatSearchResultsForDisplay({
      results: [
        { id: '1', type: 'email', title: 'Subject', score: 1 },
        { id: '2', type: 'playlist', title: 'Music', score: 0.9 },
        { id: '3', type: 'ai_conversation', title: 'Chat', score: 0.8 }
      ],
      totalFound: 3,
      query: 'test'
    });

    expect(formatted).toContain('Email');
    expect(formatted).toContain('Playlist');
    expect(formatted).toContain('AI Chat');
  });

  it('should format file type correctly', () => {
    const formatted = formatSearchResultsForDisplay({
      results: [{ id: '1', type: 'file', title: 'document.pdf', score: 1 }],
      totalFound: 1,
      query: 'document'
    });

    expect(formatted).toContain('File');
  });

  it('should format album type correctly', () => {
    const formatted = formatSearchResultsForDisplay({
      results: [{ id: '1', type: 'album', title: 'My Album', score: 1 }],
      totalFound: 1,
      query: 'album'
    });

    expect(formatted).toContain('Album');
  });
});
