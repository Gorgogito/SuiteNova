import { useState, type ComponentProps } from 'react';
import { ProofTextarea } from './ProofTextarea';

/** Un campo de texto con corrector que guarda su valor aparte (para quien lo lee al salir, como el memo de un formulario de Base). */
export function ProofMemo({ initial, ...rest }: Omit<ComponentProps<typeof ProofTextarea>, 'value' | 'onChange'> & { initial: string }) {
  const [v, setV] = useState(initial);
  return <ProofTextarea {...rest} value={v} onChange={(e) => setV(e.target.value)} />;
}
