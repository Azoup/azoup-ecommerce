import { useEffect, useRef, useState } from 'react';
import { IconMoreVertical } from './Icons';
export function CadastroListActionsMenu({ onEdit, onDuplicate, onDelete, onInactivate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="list-actions" ref={ref}>
      {onEdit && (
        <button type="button" className="btn btn-sm btn-outline" onClick={onEdit}>
          Editar
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mais ações"
      >
        <IconMoreVertical size={18} />
      </button>
      {open && (
        <div className="list-actions-menu">
          {onDuplicate && (
            <button type="button" onClick={() => { onDuplicate(); setOpen(false); }}>
              Duplicar
            </button>
          )}
          {onInactivate && (
            <button type="button" onClick={() => { onInactivate(); setOpen(false); }}>
              Inativar
            </button>
          )}
          {onDelete && (
            <button type="button" className="danger" onClick={() => { onDelete(); setOpen(false); }}>
              Excluir
            </button>
          )}
        </div>
      )}
    </div>
  );
}
