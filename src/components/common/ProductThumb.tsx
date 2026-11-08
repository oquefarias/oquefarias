import React, { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import { getSafeProductImageUrl } from '../../types';

interface ProductThumbProps {
  product?: {
    imageUrl?: string | null;
    image?: string | null;
    name?: string;
  } | null;
  alt?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const ProductThumb: React.FC<ProductThumbProps> = ({
  product,
  alt,
  size = 'md',
  className = '',
}) => {
  const safeSrc = getSafeProductImageUrl(product);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [safeSrc]);

  const sizeClasses =
    size === 'sm'
      ? 'w-8 h-8 rounded-lg'
      : 'w-12 h-12 sm:w-14 sm:h-14 rounded-xl';
  const pixelDim = size === 'sm' ? 32 : 56;
  const iconClasses = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  if (!safeSrc || hasError) {
    return (
      <div
        className={`${sizeClasses} bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400 shrink-0 ${className}`}
        aria-hidden="true"
      >
        <Package className={iconClasses} />
      </div>
    );
  }

  return (
    <img
      src={safeSrc}
      alt={alt || product?.name || 'Produto'}
      width={pixelDim}
      height={pixelDim}
      loading="lazy"
      decoding="async"
      onError={() => setHasError(true)}
      className={`${sizeClasses} object-cover border border-neutral-200 bg-neutral-100 shrink-0 ${className}`}
    />
  );
};
