/**
 * The shared "nothing here yet" block.
 *
 * Two things used to go wrong with hand-rolled empty states: the text stretched
 * across the full page width on a wide monitor, which left it stranded in the
 * middle of nowhere, and it shipped as bare text with no visual anchor. This
 * caps the copy in a centred column and gives callers a slot for the same
 * 64x48 flat illustration weight the rest of the app uses.
 *
 * Title and body reuse .list-empty-title / .list-empty-text so the type stays
 * identical to the list view's empty state.
 */
export default function EmptyState({ icon, title, text, children }) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        {icon}
        <p className="list-empty-title">{title}</p>
        {text ? <p className="list-empty-text">{text}</p> : null}
        {children}
      </div>
    </div>
  );
}