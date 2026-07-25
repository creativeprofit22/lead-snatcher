'use client';

import { useState } from 'react';
import { Plus, X, Pencil, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { CrmTagsResource } from '@/lib/hooks/useCrmTags';
import type { TagWithCount } from '@/types';

// Predefined colors for quick selection
const TAG_COLORS = [
  '#3b82f6', // Blue
  '#22c55e', // Green
  '#f97316', // Orange
  '#ec4899', // Pink
  '#a855f7', // Purple
  '#14b8a6', // Teal
  '#eab308', // Yellow
  '#ef4444', // Red
  '#6b7280', // Gray
];

export type TagMutationResult =
  | { type: 'created'; tag: TagWithCount }
  | { type: 'updated'; tag: TagWithCount }
  | { type: 'deleted'; tagId: string };

interface TagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  tagCatalog: CrmTagsResource;
  onMutation: (mutation: TagMutationResult) => Promise<void>;
}

export function TagManager({ isOpen, onClose, tagCatalog, onMutation }: TagManagerProps) {
  const { tags, loading: isLoading, error, refetch } = tagCatalog;
  const [isMutating, setIsMutating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Create tag
  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Tag name is required');
      return;
    }

    setIsMutating(true);
    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });

      if (response.ok) {
        const data = (await response.json()) as { tag: TagWithCount };
        setNewName('');
        setNewColor(TAG_COLORS[0]);
        setIsCreating(false);
        await onMutation({ type: 'created', tag: data.tag });
        toast.success('Tag created');
      } else {
        const mutationError = await response.json();
        toast.error(mutationError.error || 'Failed to create tag');
      }
    } catch {
      toast.error('Failed to create tag');
    } finally {
      setIsMutating(false);
    }
  };

  // Update tag
  const handleUpdate = async (id: string) => {
    if (!editName.trim()) {
      toast.error('Tag name is required');
      return;
    }

    setIsMutating(true);
    try {
      const response = await fetch(`/api/tags/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });

      if (response.ok) {
        const data = (await response.json()) as { tag: TagWithCount };
        setEditingId(null);
        await onMutation({ type: 'updated', tag: data.tag });
        toast.success('Tag updated');
      } else {
        const mutationError = await response.json();
        toast.error(mutationError.error || 'Failed to update tag');
      }
    } catch {
      toast.error('Failed to update tag');
    } finally {
      setIsMutating(false);
    }
  };

  // Delete tag
  const handleDelete = async (id: string) => {
    const tag = tags.find((item) => item.id === id);
    if (tag && tag.leadCount > 0) {
      if (!confirm(`This tag is used on ${tag.leadCount} lead(s). Delete anyway?`)) {
        return;
      }
    }

    setIsMutating(true);
    try {
      const response = await fetch(`/api/tags/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await onMutation({ type: 'deleted', tagId: id });
        toast.success('Tag deleted');
      } else {
        toast.error('Failed to delete tag');
      }
    } catch {
      toast.error('Failed to delete tag');
    } finally {
      setIsMutating(false);
    }
  };

  // Start editing
  const startEditing = (tag: TagWithCount) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-md max-h-[80vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-lg font-medium text-white">Manage Tags</h2>
            <button
              onClick={onClose}
              aria-label="Close tag manager"
              className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <div role="alert" className="py-8 text-center">
                <p className="text-sm text-gray-300">Failed to load tags</p>
                <button
                  onClick={() => void refetch()}
                  className="mt-3 px-3 py-1.5 text-sm text-white border border-white/20 rounded-lg hover:bg-white/5 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Existing tags */}
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                    {editingId === tag.id ? (
                      /* Edit mode */
                      <div className="flex-1 space-y-3">
                        {/* Color picker row */}
                        <div className="flex items-center gap-1.5">
                          {TAG_COLORS.map((color) => (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              disabled={isMutating}
                              aria-label={`Set tag color to ${color}`}
                              className={`w-6 h-6 rounded-full transition-transform flex-shrink-0 disabled:opacity-50 ${
                                editColor === color
                                  ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900'
                                  : 'hover:scale-110'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        {/* Input row */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            aria-label={`Rename ${tag.name}`}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            disabled={isMutating}
                            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-white/20 disabled:opacity-50"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleUpdate(tag.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button
                            onClick={() => void handleUpdate(tag.id)}
                            disabled={isMutating}
                            aria-label={`Save ${tag.name}`}
                            className="p-2 rounded-lg text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={isMutating}
                            aria-label={`Cancel editing ${tag.name}`}
                            className="p-2 rounded-lg text-gray-500 hover:bg-white/5 disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <>
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 text-sm text-gray-200">{tag.name}</span>
                        <span className="text-xs text-gray-500">{tag.leadCount} leads</span>
                        <button
                          onClick={() => startEditing(tag)}
                          disabled={isMutating}
                          aria-label={`Edit ${tag.name}`}
                          className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-50"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void handleDelete(tag.id)}
                          disabled={isMutating}
                          aria-label={`Delete ${tag.name}`}
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {/* Empty state */}
                {tags.length === 0 && !isCreating && (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-sm">No tags yet</p>
                    <p className="text-xs mt-1">Create your first tag to organize leads</p>
                  </div>
                )}

                {/* Create new tag form */}
                {isCreating && (
                  <div className="p-3 bg-white/5 rounded-lg border border-white/20 space-y-3">
                    {/* Color picker row */}
                    <div className="flex items-center gap-1.5">
                      {TAG_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => setNewColor(color)}
                          disabled={isMutating}
                          aria-label={`Set new tag color to ${color}`}
                          className={`w-6 h-6 rounded-full transition-transform flex-shrink-0 disabled:opacity-50 ${
                            newColor === color
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900'
                              : 'hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    {/* Input row */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label="New tag name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Tag name..."
                        disabled={isMutating}
                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 outline-none focus:border-white/20 disabled:opacity-50"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreate();
                          if (e.key === 'Escape') {
                            setIsCreating(false);
                            setNewName('');
                          }
                        }}
                      />
                      <button
                        onClick={() => void handleCreate()}
                        disabled={isMutating}
                        aria-label="Save new tag"
                        className="p-2 rounded-lg text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setIsCreating(false);
                          setNewName('');
                        }}
                        disabled={isMutating}
                        aria-label="Cancel creating tag"
                        className="p-2 rounded-lg text-gray-500 hover:bg-white/5 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10">
            {!isCreating && (
              <button
                onClick={() => setIsCreating(true)}
                disabled={isLoading || !!error || isMutating}
                className="flex items-center gap-2 w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Create new tag
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
