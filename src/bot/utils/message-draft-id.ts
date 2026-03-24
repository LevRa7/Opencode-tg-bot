export interface MessageDraftIdAllocator {
  next(): number;
}

export class SequentialMessageDraftIdAllocator implements MessageDraftIdAllocator {
  private nextDraftId = 1;

  next(): number {
    const draftId = this.nextDraftId;
    this.nextDraftId += 1;
    return draftId;
  }
}
