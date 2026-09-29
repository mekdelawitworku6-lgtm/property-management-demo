import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, ExpenseFilterDto, UpdateExpenseDto } from './dto/expense.dto';

@ApiTags('Expenses')
@ApiBearerAuth('access-token')
@Controller('expenses')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Record a property expense' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  findAll(@CurrentUser() user: AuthUser, @Query() filter: ExpenseFilterDto) {
    return this.expensesService.findAll(user, filter);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.remove(user, id);
  }
}
