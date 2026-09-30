-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_escalatedById_fkey" FOREIGN KEY ("escalatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
