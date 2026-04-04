'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';

interface PatternSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: string) => void;
}

const patterns = [
  'adder.lif.txt',
  'ak47.lif.txt',
  'aqua40.lif.txt',
  'hotel.lif.txt',
  'lonedots.lif.txt',
  'loop.lif.txt',
  'primes.lif.txt',
  'race.lif.txt',
  'rakegun.lif.txt',
  'randgun.lif.txt',
  'switchen.lif.txt',
  'thingun2.lif.txt',
];

const PatternSelector = ({ open, onOpenChange, onSelect }: PatternSelectorProps) => {
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (filename: string) => {
    setLoading(filename);
    try {
      const response = await fetch(`/patterns/${filename}`);
      const content = await response.text();
      onSelect(content);
    } catch (error) {
      console.error('Failed to load pattern:', error);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select a Pattern</DialogTitle>
          <DialogDescription>
            Choose from a variety of Conway&apos;s Game of Life patterns. Click on a pattern to load it into the grid.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-1">
            {patterns.map((pattern) => (
              <Button
                key={pattern}
                variant="outline"
                onClick={() => handleSelect(pattern)}
                disabled={loading === pattern}
                className="h-20 text-base font-semibold"
              >
                {loading === pattern ? 'Loading...' : pattern.replace('.lif.txt', '').toUpperCase()}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default PatternSelector;
