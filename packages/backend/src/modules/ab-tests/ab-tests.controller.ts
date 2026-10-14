import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AbTestsService } from './ab-tests.service';
import { AbTestListQueryDto, AbTestStatusDto, CreateAbTestDto, UpdateAbTestDto } from './dto/ab-test.dto';

/** Testes A/B, para o painel. Tudo escopado ao dono da área. */
@Controller('ab-tests')
@UseGuards(AuthGuard)
export class AbTestsController {
  constructor(private readonly abTests: AbTestsService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: AbTestListQueryDto) {
    return this.abTests.list(userId, query.workspace_id);
  }

  /** O teste com o resultado de cada variante e a estatística já calculada. */
  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.abTests.get(userId, id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAbTestDto) {
    return this.abTests.create(userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAbTestDto,
  ) {
    return this.abTests.update(userId, id, dto);
  }

  /** Iniciar, pausar ou encerrar. */
  @Post(':id/status')
  setStatus(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AbTestStatusDto,
  ) {
    return this.abTests.setStatus(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.abTests.remove(userId, id);
  }
}
